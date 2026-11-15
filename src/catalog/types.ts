import type { Lang } from '../i18n/strings.js';

export type Localized = Record<Lang, string>;

export interface Category {
  id: string;
  name: Localized;
  /** Lower comes first. */
  sort: number;
}

export interface Product {
  id: string;
  categoryId: string;
  name: Localized;
  description: Localized;
  /** Regular price in Taka. */
  price: number;
  /** Discounted price, if any. */
  salePrice?: number;
  /** Telegram file_id or HTTPS URL. */
  photo?: string;
  /** `undefined` means unlimited. */
  stock?: number;
  active: boolean;
  sort: number;
}

export interface Catalog {
  categories: Category[];
  products: Product[];
  loadedAt: number;
}

/** Something that can produce the catalogue (a JSON file, a Google Sheet, ...). */
export interface CatalogSource {
  readonly name: string;
  load(): Promise<Omit<Catalog, 'loadedAt'>>;
}

/** Price the customer pays for one unit. */
export function unitPrice(p: Product): number {
  return p.salePrice !== undefined && p.salePrice < p.price ? p.salePrice : p.price;
}

export function localized(value: Localized, lang: Lang): string {
  return value[lang] || value.en || value.bn;
}
