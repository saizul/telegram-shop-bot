import type { TelegramApi } from '../../src/telegram/api.js';
import { TelegramApiError } from '../../src/telegram/api.js';
import type { Chat, Message, Update, User } from '../../src/telegram/types.js';

export interface Call {
  method: string;
  params: Record<string, unknown>;
}

/**
 * In-memory Telegram API. Records every call, hands out message ids, and can be told to fail
 * a method once (to exercise error paths).
 */
export class FakeTelegramApi implements TelegramApi {
  calls: Call[] = [];
  private nextMessageId = 1000;
  private failures = new Map<string, Error>();
  updates: Update[][] = [];

  failNext(method: string, error: Error = new TelegramApiError(method, 400, 'Bad Request: test failure')): void {
    this.failures.set(method, error);
  }

  private record(method: string, params: object): void {
    this.calls.push({ method, params: params as Record<string, unknown> });
    const failure = this.failures.get(method);
    if (failure) {
      this.failures.delete(method);
      throw failure;
    }
  }

  private message(params: { chat_id: number | string; text?: string; caption?: string; photo?: string }): Message {
    const chat: Chat = { id: Number(params.chat_id), type: Number(params.chat_id) < 0 ? 'supergroup' : 'private' };
    const msg: Message = { message_id: this.nextMessageId++, date: 0, chat };
    if (params.text !== undefined) msg.text = params.text;
    if (params.caption !== undefined) msg.caption = params.caption;
    if (params.photo !== undefined) msg.photo = [{ file_id: params.photo, file_unique_id: 'u', width: 1, height: 1 }];
    return msg;
  }

  /** Calls of one method. */
  of(method: string): Array<Record<string, unknown>> {
    return this.calls.filter((c) => c.method === method).map((c) => c.params);
  }

  /** Last call of a method. */
  last(method: string): Record<string, unknown> | undefined {
    return this.of(method).at(-1);
  }

  /** Every text the bot sent or edited, in order. */
  texts(): string[] {
    return this.calls
      .filter((c) => ['sendMessage', 'editMessageText', 'sendPhoto'].includes(c.method))
      .map((c) => String(c.params.text ?? c.params.caption ?? ''));
  }

  reset(): void {
    this.calls = [];
  }

  async getMe(): Promise<User> {
    this.record('getMe', {});
    return { id: 1, is_bot: true, first_name: 'Shop', username: 'test_shop_bot' };
  }
  async sendMessage(params: Parameters<TelegramApi['sendMessage']>[0]): Promise<Message> {
    this.record('sendMessage', params);
    return this.message(params);
  }
  async sendPhoto(params: Parameters<TelegramApi['sendPhoto']>[0]): Promise<Message> {
    this.record('sendPhoto', params);
    return this.message(params);
  }
  async editMessageText(params: Parameters<TelegramApi['editMessageText']>[0]): Promise<Message | true> {
    this.record('editMessageText', params);
    return true;
  }
  async editMessageCaption(params: Parameters<TelegramApi['editMessageCaption']>[0]): Promise<Message | true> {
    this.record('editMessageCaption', params);
    return true;
  }
  async editMessageReplyMarkup(params: Parameters<TelegramApi['editMessageReplyMarkup']>[0]): Promise<Message | true> {
    this.record('editMessageReplyMarkup', params);
    return true;
  }
  async deleteMessage(params: Parameters<TelegramApi['deleteMessage']>[0]): Promise<true> {
    this.record('deleteMessage', params);
    return true;
  }
  async answerCallbackQuery(params: Parameters<TelegramApi['answerCallbackQuery']>[0]): Promise<true> {
    this.record('answerCallbackQuery', params);
    return true;
  }
  async getUpdates(params: Parameters<TelegramApi['getUpdates']>[0]): Promise<Update[]> {
    this.record('getUpdates', params);
    const next = this.updates.shift();
    // Behave like long polling: an empty queue waits a little instead of returning at once.
    if (!next) await new Promise((r) => setTimeout(r, 5));
    return next ?? [];
  }
  async setWebhook(params: Parameters<TelegramApi['setWebhook']>[0]): Promise<true> {
    this.record('setWebhook', params);
    return true;
  }
  async deleteWebhook(params: Parameters<TelegramApi['deleteWebhook']>[0] = {}): Promise<true> {
    this.record('deleteWebhook', params);
    return true;
  }
  async setMyCommands(params: Parameters<TelegramApi['setMyCommands']>[0]): Promise<true> {
    this.record('setMyCommands', params);
    return true;
  }
}
