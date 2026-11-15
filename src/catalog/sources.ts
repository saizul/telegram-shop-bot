import { readFile } from 'node:fs/promises';
import type { SheetsClient } from '../google/sheets.js';
import {
  CatalogError,
  buildCatalog,
  parseCategory,
  parseProduct,
  rowsToObjects,
  type RawCategory,
  type RawProduct,
} from './parse.js';
import type { Catalog, CatalogSource } from './types.js';

/**
 * JSON catalogue file:
 * `{ "categories": [{ "id", "name_en", "name_bn", "sort"? }], "products": [{ "id", "category", ... }] }`
 */
export class JsonCatalogSource implements CatalogSource {
  readonly name = 'json';
  constructor(
    private readonly path: string,
    private readonly read: (path: string) => Promise<string> = (p) => readFile(p, 'utf8'),
  ) {}

  async load(): Promise<Omit<Catalog, 'loadedAt'>> {
    let data: unknown;
    try {
      data = JSON.parse(await this.read(this.path));
    } catch (err) {
      throw new CatalogError(`Cannot read catalogue ${this.path}: ${(err as Error).message}`);
    }
    return parseCatalogObject(data, this.path);
  }
}

export function parseCatalogObject(data: unknown, where = 'catalogue'): Omit<Catalog, 'loadedAt'> {
  if (!data || typeof data !== 'object') throw new CatalogError(`${where}: expected an object`);
  const obj = data as { categories?: unknown; products?: unknown };
  if (!Array.isArray(obj.products)) throw new CatalogError(`${where}: "products" must be an array`);
  const categories = Array.isArray(obj.categories)
    ? obj.categories.map((c, i) => parseCategory(c as RawCategory, `${where} categories[${i}]`, i))
    : [];
  const products = obj.products.map((p, i) => parseProduct(p as RawProduct, `${where} products[${i}]`, i));
  return buildCatalog(categories, products);
}

export interface SheetsCatalogOptions {
  spreadsheetId: string;
  /** Default `Products!A1:L`. Header row required. */
  productsRange?: string;
  /** Default `Categories!A1:D`. Optional tab; missing tab is fine. */
  categoriesRange?: string | null;
}

/**
 * Google Sheets catalogue. Columns (header names, any order):
 * `id, category, name_en, name_bn, description_en, description_bn, price, sale_price, photo, stock, active, sort`.
 */
export class SheetsCatalogSource implements CatalogSource {
  readonly name = 'sheets';
  constructor(
    private readonly sheets: SheetsClient,
    private readonly options: SheetsCatalogOptions,
  ) {}

  async load(): Promise<Omit<Catalog, 'loadedAt'>> {
    const { spreadsheetId } = this.options;
    const productsRange = this.options.productsRange ?? 'Products!A1:L';
    const categoriesRange = this.options.categoriesRange === undefined ? 'Categories!A1:D' : this.options.categoriesRange;
    const productRows = await this.sheets.getValues(spreadsheetId, productsRange);
    let categoryRows: unknown[][] = [];
    if (categoriesRange) {
      try {
        categoryRows = await this.sheets.getValues(spreadsheetId, categoriesRange);
      } catch (err) {
        // A missing Categories tab returns HTTP 400 "Unable to parse range"; categories are optional.
        if (!/Unable to parse range|400/.test((err as Error).message)) throw err;
      }
    }
    const categories = rowsToObjects(categoryRows).map((r, i) =>
      parseCategory(r as RawCategory, `${categoriesRange} row ${i + 2}`, i),
    );
    const products = rowsToObjects(productRows).map((r, i) =>
      parseProduct(r as RawProduct, `${productsRange} row ${i + 2}`, i),
    );
    return buildCatalog(categories, products);
  }
}
