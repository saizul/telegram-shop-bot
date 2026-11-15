import type {
  AnswerCallbackQueryParams,
  DeleteMessageParams,
  DeleteWebhookParams,
  EditMessageCaptionParams,
  EditMessageReplyMarkupParams,
  EditMessageTextParams,
  GetUpdatesParams,
  Message,
  SendMessageParams,
  SendPhotoParams,
  SetMyCommandsParams,
  SetWebhookParams,
  Update,
  User,
} from './types.js';

/**
 * Everything the bot needs from Telegram. The bot only talks to this interface, so tests can
 * pass an in-memory fake and never touch the network.
 */
export interface TelegramApi {
  getMe(): Promise<User>;
  sendMessage(params: SendMessageParams): Promise<Message>;
  sendPhoto(params: SendPhotoParams): Promise<Message>;
  editMessageText(params: EditMessageTextParams): Promise<Message | true>;
  editMessageCaption(params: EditMessageCaptionParams): Promise<Message | true>;
  editMessageReplyMarkup(params: EditMessageReplyMarkupParams): Promise<Message | true>;
  deleteMessage(params: DeleteMessageParams): Promise<true>;
  answerCallbackQuery(params: AnswerCallbackQueryParams): Promise<true>;
  getUpdates(params: GetUpdatesParams, signal?: AbortSignal): Promise<Update[]>;
  setWebhook(params: SetWebhookParams): Promise<true>;
  deleteWebhook(params?: DeleteWebhookParams): Promise<true>;
  setMyCommands(params: SetMyCommandsParams): Promise<true>;
}

/** Error returned by the Bot API (`ok: false`). */
export class TelegramApiError extends Error {
  readonly method: string;
  readonly errorCode: number;
  readonly retryAfter: number | undefined;

  constructor(method: string, errorCode: number, description: string, retryAfter?: number) {
    super(`Telegram ${method} failed (${errorCode}): ${description}`);
    this.name = 'TelegramApiError';
    this.method = method;
    this.errorCode = errorCode;
    this.retryAfter = retryAfter;
  }

  /** "message is not modified" is harmless: the user pressed the same button twice. */
  get isNotModified(): boolean {
    return this.errorCode === 400 && /message is not modified/i.test(this.message);
  }
}

interface ApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

export interface HttpTelegramApiOptions {
  token: string;
  /** Default `https://api.telegram.org`. Point it at a local Bot API server if you run one. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Per-request timeout in ms (long polling adds its own timeout on top). Default 15000. */
  timeoutMs?: number;
  /** Retry once on HTTP 429 when retry_after is at most this many seconds. Default 5. */
  maxRetryAfter?: number;
  sleep?: (ms: number) => Promise<void>;
}

const TOKEN_RE = /^\d+:[A-Za-z0-9_-]{30,}$/;

/** Bot API client over HTTPS using `fetch`. */
export class HttpTelegramApi implements TelegramApi {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetryAfter: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: HttpTelegramApiOptions) {
    if (!TOKEN_RE.test(options.token)) throw new Error('TELEGRAM_BOT_TOKEN does not look like a bot token');
    this.base = `${(options.baseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '')}/bot${options.token}`;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetryAfter = options.maxRetryAfter ?? 5;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Call any Bot API method with a JSON body. */
  async call<T>(method: string, params: object = {}, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs);
      const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
      const res = await this.fetchImpl(`${this.base}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal,
      });
      let body: ApiResponse<T>;
      try {
        body = (await res.json()) as ApiResponse<T>;
      } catch {
        throw new TelegramApiError(method, res.status, `invalid JSON response (HTTP ${res.status})`);
      }
      if (body.ok) return body.result as T;
      const retryAfter = body.parameters?.retry_after;
      const code = body.error_code ?? res.status;
      if (code === 429 && retryAfter !== undefined && retryAfter <= this.maxRetryAfter && attempt === 0) {
        await this.sleep(retryAfter * 1000);
        continue;
      }
      throw new TelegramApiError(method, code, body.description ?? 'unknown error', retryAfter);
    }
  }

  getMe(): Promise<User> {
    return this.call('getMe');
  }
  sendMessage(params: SendMessageParams): Promise<Message> {
    return this.call('sendMessage', params);
  }
  sendPhoto(params: SendPhotoParams): Promise<Message> {
    return this.call('sendPhoto', params);
  }
  editMessageText(params: EditMessageTextParams): Promise<Message | true> {
    return this.call('editMessageText', params);
  }
  editMessageCaption(params: EditMessageCaptionParams): Promise<Message | true> {
    return this.call('editMessageCaption', params);
  }
  editMessageReplyMarkup(params: EditMessageReplyMarkupParams): Promise<Message | true> {
    return this.call('editMessageReplyMarkup', params);
  }
  deleteMessage(params: DeleteMessageParams): Promise<true> {
    return this.call('deleteMessage', params);
  }
  answerCallbackQuery(params: AnswerCallbackQueryParams): Promise<true> {
    return this.call('answerCallbackQuery', params);
  }
  getUpdates(params: GetUpdatesParams, signal?: AbortSignal): Promise<Update[]> {
    // The HTTP request has to outlive the long-polling timeout.
    const timeoutMs = ((params.timeout ?? 0) + 10) * 1000;
    return this.call('getUpdates', params, signal ? { timeoutMs, signal } : { timeoutMs });
  }
  setWebhook(params: SetWebhookParams): Promise<true> {
    return this.call('setWebhook', params);
  }
  deleteWebhook(params: DeleteWebhookParams = {}): Promise<true> {
    return this.call('deleteWebhook', params);
  }
  setMyCommands(params: SetMyCommandsParams): Promise<true> {
    return this.call('setMyCommands', params);
  }
}
