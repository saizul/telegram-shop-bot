import { LIMITS, type InlineKeyboardButton, type InlineKeyboardMarkup } from './types.js';

/** Escape text for `parse_mode: 'HTML'`. Use on every piece of user or catalog content. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Byte length in UTF-8, the unit Telegram uses for callback_data. */
export function utf8Length(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** Build a callback button, refusing data longer than the 64-byte limit. */
export function button(text: string, data: string): InlineKeyboardButton {
  const len = utf8Length(data);
  if (len < 1 || len > LIMITS.callbackData) {
    throw new RangeError(`callback_data must be 1-${LIMITS.callbackData} bytes, got ${len}: ${data}`);
  }
  return { text, callback_data: data };
}

export function urlButton(text: string, url: string): InlineKeyboardButton {
  return { text, url };
}

export function inlineKeyboard(rows: InlineKeyboardButton[][]): InlineKeyboardMarkup {
  return { inline_keyboard: rows.filter((r) => r.length > 0) };
}

/** Split buttons into rows of `perRow`. */
export function chunk<T>(items: readonly T[], perRow: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow));
  return rows;
}

/**
 * Shorten text to `max` characters (code points), adding an ellipsis.
 * Use before sending captions (1024) and messages (4096).
 */
export function truncate(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, Math.max(0, max - 1)).join('') + '…';
}
