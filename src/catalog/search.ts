import { toAsciiDigits } from '../bd/digits.js';
import type { Category, Product } from './types.js';

/** Longest query that is searched; longer text is cut. */
export const MAX_QUERY_LENGTH = 64;

/**
 * Lower-case, ASCII digits, punctuation to spaces, single spaces. Bangla letters and vowel signs
 * are kept as they are (`\p{L}` and `\p{M}`), so "জামদানি" matches "ঢাকাই জামদানি".
 */
export function normalizeSearchText(text: string): string {
  return toAsciiDigits(text.normalize('NFC').toLowerCase())
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

export interface SearchResult {
  product: Product;
  score: number;
}

/**
 * Find active products whose name, description, id or category name contains every word of
 * `query` (in either language). Name matches rank above description matches; ties keep the
 * catalogue order (`sort`, then name).
 */
export function searchProducts(products: Product[], categories: Category[], query: string): SearchResult[] {
  const words = normalizeSearchText(query.slice(0, MAX_QUERY_LENGTH)).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const categoryNames = new Map(categories.map((c) => [c.id, normalizeSearchText(`${c.name.en} ${c.name.bn}`)]));
  const phrase = words.join(' ');
  const results: SearchResult[] = [];
  for (const product of products) {
    if (!product.active) continue;
    const name = normalizeSearchText(`${product.name.en} ${product.name.bn}`);
    const id = normalizeSearchText(product.id);
    const other = `${normalizeSearchText(`${product.description.en} ${product.description.bn}`)} ${categoryNames.get(product.categoryId) ?? ''}`;
    let score = 0;
    let all = true;
    for (const word of words) {
      if (name.includes(word)) score += 3;
      else if (id.includes(word)) score += 2;
      else if (other.includes(word)) score += 1;
      else {
        all = false;
        break;
      }
    }
    if (!all) continue;
    if (name.includes(phrase)) score += 2;
    if (name.startsWith(phrase) || name.includes(` ${phrase}`)) score += 1;
    results.push({ product, score });
  }
  return results.sort(
    (a, b) => b.score - a.score || a.product.sort - b.product.sort || a.product.name.en.localeCompare(b.product.name.en),
  );
}
