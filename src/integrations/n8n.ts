import { createHmac } from 'node:crypto';
import type { OrderEvent, OrderEventSink } from './events.js';

export interface WebhookSinkOptions {
  url: string;
  /** Shared secret for the `X-Shop-Signature` HMAC header. Optional but recommended. */
  secret?: string;
  /** Attempts in total, including the first. Default 3. */
  attempts?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Compute the signature header value: `sha256=<hex HMAC of "<timestamp>.<body>">`.
 * Including the timestamp lets the receiver reject replays.
 */
export function signPayload(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/**
 * Posts order events as JSON to an n8n Webhook node (or any HTTPS endpoint).
 * Retries network errors and 5xx/429 responses with exponential backoff.
 */
export class WebhookSink implements OrderEventSink {
  readonly name = 'n8n-webhook';
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly options: WebhookSinkOptions) {
    const url = new URL(options.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('N8N_WEBHOOK_URL must be an http(s) URL');
    // Plain HTTP only for localhost or a bare service name on a private network (docker-compose "n8n").
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || !url.hostname.includes('.');
    if (url.protocol === 'http:' && !local) throw new Error('N8N_WEBHOOK_URL must use https for public hosts');
    if (url.username || url.password) throw new Error('N8N_WEBHOOK_URL must not contain credentials; use N8N_WEBHOOK_SECRET');
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? Date.now;
  }

  static payload(event: OrderEvent): Record<string, unknown> {
    const { order } = event;
    return {
      event: event.type,
      at: event.at,
      previousStatus: event.type === 'order.status_changed' ? event.previousStatus : undefined,
      changedBy: event.type === 'order.status_changed' ? event.by : undefined,
      order: {
        id: order.id,
        status: order.status,
        createdAt: order.createdAt,
        lang: order.lang,
        customer: order.customer,
        telegram: { userId: order.userId, chatId: order.chatId, username: order.username },
        payment: order.payment,
        zone: order.zone,
        lines: order.lines,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        total: order.total,
      },
    };
  }

  async handle(event: OrderEvent): Promise<void> {
    const body = JSON.stringify(WebhookSink.payload(event));
    const attempts = this.options.attempts ?? 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const timestamp = String(Math.floor(this.now() / 1000));
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-shop-event': event.type,
        'x-shop-timestamp': timestamp,
        'x-shop-delivery': `${event.order.id}:${event.type}:${event.at}`,
      };
      if (this.options.secret) headers['x-shop-signature'] = signPayload(this.options.secret, timestamp, body);
      let res: Response;
      try {
        res = await this.fetchImpl(this.options.url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
        });
      } catch (err) {
        lastError = err; // network error or timeout: retry
        if (attempt < attempts) await this.sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      if (res.ok) return;
      lastError = new Error(`webhook responded ${res.status}`);
      // Client errors (other than 429) will not fix themselves.
      if (res.status < 500 && res.status !== 429) throw lastError;
      if (attempt < attempts) await this.sleep(500 * 2 ** (attempt - 1));
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
