import { toBanglaDigits } from './digits.js';

/**
 * Format an amount in Taka with South Asian digit grouping (1,23,456).
 * Bangla output uses Bangla digits: `৳১,২৩,৪৫৬`.
 */
export function formatTaka(amount: number, lang: 'en' | 'bn' = 'en'): string {
  if (!Number.isFinite(amount)) throw new RangeError(`Invalid amount ${amount}`);
  const negative = amount < 0;
  const fixed = Math.abs(Math.round(amount * 100) / 100);
  const [intPart, frac] = (Number.isInteger(fixed) ? String(fixed) : fixed.toFixed(2)).split('.') as [string, string?];
  let grouped = intPart;
  if (intPart.length > 3) {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${rest},${last3}`;
  }
  const text = `${negative ? '-' : ''}৳${grouped}${frac ? `.${frac}` : ''}`;
  return lang === 'bn' ? toBanglaDigits(text) : text;
}
