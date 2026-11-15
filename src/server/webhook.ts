import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Logger } from '../logger.js';
import { SECRET_TOKEN_HEADER, type Update } from '../telegram/types.js';

export interface WebhookServerOptions {
  path: string;
  secretToken: string;
  handle: (update: Update) => Promise<void>;
  logger: Logger;
  /** Largest accepted body in bytes. Default 1 MiB (Telegram updates are a few KB). */
  maxBodyBytes?: number;
  /** Extra readiness check for /healthz. */
  healthy?: () => boolean;
}

/** Constant-time comparison of the secret token header. */
export function verifySecretToken(received: string | string[] | undefined, expected: string): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function reply(res: ServerResponse, status: number, body = ''): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

/**
 * HTTP handler for Telegram webhooks. Verifies `X-Telegram-Bot-Api-Secret-Token`, answers 200
 * straight away and processes the update in the background, so slow sinks (Sheets, n8n) never
 * make Telegram retry.
 */
export function createWebhookHandler(options: WebhookServerOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const limit = options.maxBodyBytes ?? 1024 * 1024;
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      const ok = options.healthy ? options.healthy() : true;
      reply(res, ok ? 200 : 503, ok ? 'ok' : 'unhealthy');
      return;
    }
    if (url.pathname !== options.path) {
      reply(res, 404, 'not found');
      return;
    }
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      reply(res, 405, 'method not allowed');
      return;
    }
    if (!verifySecretToken(req.headers[SECRET_TOKEN_HEADER], options.secretToken)) {
      options.logger.warn('webhook request with a wrong secret token', { ip: req.socket.remoteAddress });
      reply(res, 401, 'unauthorized');
      return;
    }
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
      reply(res, 415, 'unsupported media type');
      return;
    }
    readBody(req, limit)
      .then((body) => {
        let update: Update;
        try {
          update = JSON.parse(body) as Update;
        } catch {
          reply(res, 400, 'bad json');
          return;
        }
        if (typeof update?.update_id !== 'number') {
          reply(res, 400, 'not an update');
          return;
        }
        reply(res, 200, 'ok');
        options.handle(update).catch((err: unknown) => {
          options.logger.error('webhook update failed', { updateId: update.update_id, error: String(err) });
        });
      })
      .catch((err: { status?: number; message?: string }) => {
        if (!res.headersSent) reply(res, err.status ?? 400, err.message ?? 'bad request');
      });
  };
}

export function startWebhookServer(options: WebhookServerOptions & { port: number; host: string }): Promise<Server> {
  const server = createServer(createWebhookHandler(options));
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
