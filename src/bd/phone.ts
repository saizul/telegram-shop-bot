import { toAsciiDigits } from './digits.js';

export type Operator = 'Grameenphone' | 'Banglalink' | 'Robi' | 'Airtel' | 'Teletalk';

export interface BdPhone {
  /** International format, e.g. `+8801712345678`. */
  e164: string;
  /** Local 11-digit format, e.g. `01712345678`. */
  local: string;
  operator: Operator;
}

const OPERATORS: Record<string, Operator> = {
  '013': 'Grameenphone',
  '017': 'Grameenphone',
  '014': 'Banglalink',
  '019': 'Banglalink',
  '015': 'Teletalk',
  '016': 'Airtel',
  '018': 'Robi',
};

/**
 * Normalise a Bangladeshi mobile number.
 *
 * Accepts `01712345678`, `1712345678`, `+880 1712-345678`, `8801712345678`,
 * `008801712345678`, `(+880) 17 1234 5678` and Bangla digits (`০১৭১২৩৪৫৬৭৮`).
 * Returns `null` for anything that is not a valid 013-019 mobile number.
 */
export function normaliseBdPhone(input: string): BdPhone | null {
  if (typeof input !== 'string') return null;
  const ascii = toAsciiDigits(input.trim());
  // Only digits, spaces, dashes, dots, brackets and one plus sign are allowed.
  if (!/^[\d\s\-().+]+$/.test(ascii) || (ascii.match(/\+/g) ?? []).length > 1) return null;
  let digits = ascii.replace(/\D/g, '');
  if (digits.startsWith('00880')) digits = digits.slice(5);
  else if (digits.startsWith('880')) digits = digits.slice(3);
  if (digits.length === 10 && digits.startsWith('1')) digits = `0${digits}`;
  if (!/^01[3-9]\d{8}$/.test(digits)) return null;
  const operator = OPERATORS[digits.slice(0, 3)];
  if (!operator) return null;
  return { e164: `+88${digits}`, local: digits, operator };
}

/** Mask the middle digits for logs and admin previews: `017****5678`. */
export function maskPhone(local: string): string {
  return local.length === 11 ? `${local.slice(0, 3)}****${local.slice(7)}` : '***';
}
