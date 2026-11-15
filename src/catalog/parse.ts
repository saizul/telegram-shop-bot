import { toAsciiDigits } from '../bd/digits.js';
import type { Catalog, Category, Localized, Product } from './types.js';

/** Product and category ids go into callback_data, so keep them short and safe. */
export const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

function str(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/** Parse a number that may contain Bangla digits, commas, a Taka sign or "Tk". */
export function parseAmount(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const s = toAsciiDigits(str(value)).replace(/[,৳\s]|tk\.?|bdt/gi, '');
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function parseBool(value: unknown, fallback: boolean): boolean {
  const s = str(value).toLowerCase();
  if (s === '') return fallback;
  if (['true', 'yes', 'y', '1', 'active', 'হ্যাঁ'].includes(s)) return true;
  if (['false', 'no', 'n', '0', 'inactive', 'না'].includes(s)) return false;
  return fallback;
}

function localizedFrom(en: unknown, bn: unknown): Localized {
  const e = str(en);
  const b = str(bn);
  return { en: e || b, bn: b || e };
}

export interface RawProduct {
  id?: unknown;
  category?: unknown;
  name_en?: unknown;
  name_bn?: unknown;
  description_en?: unknown;
  description_bn?: unknown;
  price?: unknown;
  sale_price?: unknown;
  photo?: unknown;
  stock?: unknown;
  active?: unknown;
  sort?: unknown;
}

export interface RawCategory {
  id?: unknown;
  name_en?: unknown;
  name_bn?: unknown;
  sort?: unknown;
}

/** Validate a product record. Throws CatalogError with the row reference on bad data. */
export function parseProduct(raw: RawProduct, where: string, index: number): Product {
  const id = str(raw.id);
  if (!ID_RE.test(id)) throw new CatalogError(`${where}: product id "${id}" must be 1-32 characters of A-Z a-z 0-9 _ -`);
  const categoryId = str(raw.category);
  if (!ID_RE.test(categoryId)) throw new CatalogError(`${where}: product ${id} has an invalid category "${categoryId}"`);
  const name = localizedFrom(raw.name_en, raw.name_bn);
  if (!name.en) throw new CatalogError(`${where}: product ${id} has no name`);
  const price = parseAmount(raw.price);
  if (price === undefined || price < 0) throw new CatalogError(`${where}: product ${id} has an invalid price "${str(raw.price)}"`);
  const product: Product = {
    id,
    categoryId,
    name,
    description: localizedFrom(raw.description_en, raw.description_bn),
    price,
    active: parseBool(raw.active, true),
    sort: parseAmount(raw.sort) ?? index,
  };
  const sale = parseAmount(raw.sale_price);
  if (sale !== undefined) {
    if (sale < 0) throw new CatalogError(`${where}: product ${id} has a negative sale price`);
    product.salePrice = sale;
  }
  const stock = parseAmount(raw.stock);
  if (stock !== undefined) {
    if (!Number.isInteger(stock) || stock < 0) throw new CatalogError(`${where}: product ${id} has an invalid stock "${str(raw.stock)}"`);
    product.stock = stock;
  }
  const photo = str(raw.photo);
  if (photo) {
    if (/^https?:\/\//i.test(photo) && !/^https:\/\//i.test(photo)) {
      throw new CatalogError(`${where}: product ${id} photo must use https`);
    }
    product.photo = photo;
  }
  return product;
}

export function parseCategory(raw: RawCategory, where: string, index: number): Category {
  const id = str(raw.id);
  if (!ID_RE.test(id)) throw new CatalogError(`${where}: category id "${id}" must be 1-32 characters of A-Z a-z 0-9 _ -`);
  const name = localizedFrom(raw.name_en, raw.name_bn);
  return { id, name: name.en ? name : { en: id, bn: id }, sort: parseAmount(raw.sort) ?? index };
}

/**
 * Build a catalogue from parsed records: drops duplicate ids (first wins is an error),
 * creates categories referenced by products but not declared, and sorts everything.
 */
export function buildCatalog(categories: Category[], products: Product[]): Omit<Catalog, 'loadedAt'> {
  const catIds = new Set<string>();
  for (const c of categories) {
    if (catIds.has(c.id)) throw new CatalogError(`Duplicate category id "${c.id}"`);
    catIds.add(c.id);
  }
  const productIds = new Set<string>();
  for (const p of products) {
    if (productIds.has(p.id)) throw new CatalogError(`Duplicate product id "${p.id}"`);
    productIds.add(p.id);
    if (!catIds.has(p.categoryId)) {
      categories.push({ id: p.categoryId, name: { en: p.categoryId, bn: p.categoryId }, sort: 1000 + categories.length });
      catIds.add(p.categoryId);
    }
  }
  const bySort = <T extends { sort: number }>(a: T, b: T) => a.sort - b.sort;
  return { categories: [...categories].sort(bySort), products: [...products].sort(bySort) };
}

/** Convert a sheet (header row + rows) into objects keyed by normalised header. */
export function rowsToObjects(values: unknown[][]): Array<Record<string, unknown>> {
  const [header, ...rows] = values;
  if (!header) return [];
  const keys = header.map((h) =>
    str(h)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, ''),
  );
  return rows
    .filter((r) => r.some((c) => str(c) !== ''))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]])));
}
