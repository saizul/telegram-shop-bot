/**
 * The subset of Telegram Bot API types the shop bot uses.
 * Field names follow https://core.telegram.org/bots/api exactly.
 */

export interface User {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface Chat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
}

export interface Contact {
  phone_number: string;
  first_name: string;
  last_name?: string;
  user_id?: number;
  vcard?: string;
}

export interface PhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
}

export interface Message {
  message_id: number;
  date: number;
  chat: Chat;
  from?: User;
  text?: string;
  caption?: string;
  photo?: PhotoSize[];
  contact?: Contact;
}

export interface CallbackQuery {
  id: string;
  from: User;
  message?: Message;
  inline_message_id?: string;
  chat_instance: string;
  data?: string;
}

export interface Update {
  update_id: number;
  message?: Message;
  edited_message?: Message;
  callback_query?: CallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  /** 1-64 bytes. */
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface KeyboardButton {
  text: string;
  request_contact?: boolean;
}

export interface ReplyKeyboardMarkup {
  keyboard: KeyboardButton[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  input_field_placeholder?: string;
}

export interface ReplyKeyboardRemove {
  remove_keyboard: true;
}

export type ReplyMarkup = InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;

export type ParseMode = 'HTML' | 'MarkdownV2';

export interface BotCommand {
  command: string;
  description: string;
}

export type AllowedUpdate = 'message' | 'edited_message' | 'callback_query';

/** Parameters of the methods the bot calls. */
export interface SendMessageParams {
  chat_id: number | string;
  /** 1-4096 characters after entities parsing. */
  text: string;
  parse_mode?: ParseMode;
  reply_markup?: ReplyMarkup;
  link_preview_options?: { is_disabled?: boolean };
}

export interface SendPhotoParams {
  chat_id: number | string;
  /** file_id or HTTP URL. */
  photo: string;
  /** 0-1024 characters after entities parsing. */
  caption?: string;
  parse_mode?: ParseMode;
  reply_markup?: InlineKeyboardMarkup;
}

export interface EditMessageTextParams {
  chat_id: number | string;
  message_id: number;
  text: string;
  parse_mode?: ParseMode;
  reply_markup?: InlineKeyboardMarkup;
  link_preview_options?: { is_disabled?: boolean };
}

export interface EditMessageCaptionParams {
  chat_id: number | string;
  message_id: number;
  caption: string;
  parse_mode?: ParseMode;
  reply_markup?: InlineKeyboardMarkup;
}

export interface EditMessageReplyMarkupParams {
  chat_id: number | string;
  message_id: number;
  reply_markup?: InlineKeyboardMarkup;
}

export interface AnswerCallbackQueryParams {
  callback_query_id: string;
  /** 0-200 characters. */
  text?: string;
  show_alert?: boolean;
  url?: string;
  cache_time?: number;
}

export interface DeleteMessageParams {
  chat_id: number | string;
  message_id: number;
}

export interface GetUpdatesParams {
  offset?: number;
  limit?: number;
  /** Long polling timeout in seconds. */
  timeout?: number;
  allowed_updates?: AllowedUpdate[];
}

export interface SetWebhookParams {
  url: string;
  max_connections?: number;
  allowed_updates?: AllowedUpdate[];
  drop_pending_updates?: boolean;
  /** 1-256 characters, A-Z a-z 0-9 _ - ; sent back in X-Telegram-Bot-Api-Secret-Token. */
  secret_token?: string;
}

export interface DeleteWebhookParams {
  drop_pending_updates?: boolean;
}

export interface SetMyCommandsParams {
  commands: BotCommand[];
  language_code?: string;
}

/** Header Telegram sends with every webhook request when `secret_token` is set. */
export const SECRET_TOKEN_HEADER = 'x-telegram-bot-api-secret-token';

export const LIMITS = {
  messageText: 4096,
  caption: 1024,
  callbackData: 64,
  callbackAnswer: 200,
} as const;
