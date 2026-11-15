import { toAsciiDigits } from '../bd/digits.js';

/** Collapse whitespace and strip control characters from user input. */
export function cleanText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 2-60 characters, must contain a letter (Latin or Bangla), no digits-only names or links. */
export function validateName(input: string): string | null {
  const name = cleanText(input);
  const length = [...name].length;
  if (length < 2 || length > 60) return null;
  if (!/[A-Za-zঀ-৿]/.test(name)) return null;
  if (/https?:\/\/|www\.|@/i.test(name)) return null;
  if (/\d{4,}/.test(toAsciiDigits(name))) return null;
  return name;
}

/** 10-300 characters. Links are refused to keep spam out of the admin group. */
export function validateAddress(input: string): string | null {
  const address = cleanText(input);
  const length = [...address].length;
  if (length < 10 || length > 300) return null;
  if (/https?:\/\/|www\./i.test(address)) return null;
  return address;
}

/**
 * bKash transaction IDs printed in the confirmation SMS are 10 uppercase letters and digits;
 * accept 8-12 to allow for format changes, and normalise to uppercase.
 */
export function validateBkashTrxId(input: string): string | null {
  const id = toAsciiDigits(input).replace(/^(trx\s*id|trxid)[\s:#-]*/i, '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{8,12}$/.test(id)) return null;
  if (!/[A-Z]/.test(id) || !/\d/.test(id)) return null;
  return id;
}
