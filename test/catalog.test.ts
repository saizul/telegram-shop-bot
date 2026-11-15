import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CatalogError, parseAmount, parseBool, rowsToObjects } from '../src/catalog/parse.js';
import { CatalogService } from '../src/catalog/service.js';
import { JsonCatalogSource, SheetsCatalogSource, parseCatalogObject } from '../src/catalog/sources.js';
import { unitPrice } from '../src/catalog/types.js';
import type { SheetsClient } from '../src/google/sheets.js';

describe('catalogue parsing', () => {
  test('parseAmount handles Bangla digits, commas, Taka sign and Tk', () => {
    assert.equal(parseAmount('৳১,২৫০'), 1250);
    assert.equal(parseAmount('Tk 1,850'), 1850);
    assert.equal(parseAmount('350 BDT'), 350);
    assert.equal(parseAmount(99.5), 99.5);
    assert.equal(parseAmount(''), undefined);
    assert.equal(parseAmount('abc'), undefined);
    assert.equal(parseAmount(Number.POSITIVE_INFINITY), undefined);
  });

  test('parseBool', () => {
    assert.equal(parseBool('yes', false), true);
    assert.equal(parseBool('না', true), false);
    assert.equal(parseBool('', true), true);
    assert.equal(parseBool('maybe', false), false);
  });

  test('parses a catalogue object and auto-creates missing categories', () => {
    const c = parseCatalogObject({
      categories: [{ id: 'a', name_en: 'A', sort: 2 }],
      products: [
        { id: 'p1', category: 'a', name_en: 'One', price: '100', sale_price: 80, stock: '5' },
        { id: 'p2', category: 'b', name_bn: 'দুই', price: 50 },
      ],
    });
    assert.deepEqual(c.categories.map((x) => x.id), ['a', 'b']);
    assert.equal(c.products[1]!.name.en, 'দুই', 'falls back to the other language');
    assert.equal(unitPrice(c.products[0]!), 80);
    assert.equal(c.products[0]!.stock, 5);
    assert.equal(c.products[1]!.stock, undefined);
  });

  test('sale price higher than price is ignored for the unit price', () => {
    const c = parseCatalogObject({ products: [{ id: 'x', category: 'c', name_en: 'X', price: 100, sale_price: 150 }] });
    assert.equal(unitPrice(c.products[0]!), 100);
  });

  test('rejects bad data with the location of the problem', () => {
    const bad = (products: unknown[], re: RegExp) => assert.throws(() => parseCatalogObject({ products }, 'cat.json'), (e: unknown) => e instanceof CatalogError && re.test((e as Error).message));
    bad([{ id: 'has space', category: 'c', name_en: 'X', price: 1 }], /cat.json products\[0\]: product id/);
    bad([{ id: 'x'.repeat(33), category: 'c', name_en: 'X', price: 1 }], /product id/);
    bad([{ id: 'x', category: '', name_en: 'X', price: 1 }], /invalid category/);
    bad([{ id: 'x', category: 'c', price: 1 }], /has no name/);
    bad([{ id: 'x', category: 'c', name_en: 'X', price: -5 }], /invalid price/);
    bad([{ id: 'x', category: 'c', name_en: 'X', price: 'free' }], /invalid price/);
    bad([{ id: 'x', category: 'c', name_en: 'X', price: 1, stock: 1.5 }], /invalid stock/);
    bad([{ id: 'x', category: 'c', name_en: 'X', price: 1, photo: 'http://insecure.example/a.jpg' }], /https/);
    bad([{ id: 'x', category: 'c', name_en: 'X', price: 1 }, { id: 'x', category: 'c', name_en: 'Y', price: 2 }], /Duplicate product/);
    assert.throws(() => parseCatalogObject({ products: 'nope' }), CatalogError);
    assert.throws(() => parseCatalogObject(null), CatalogError);
  });

  test('rowsToObjects normalises headers and skips blank rows', () => {
    const rows = rowsToObjects([
      ['ID', 'Name (EN)', 'Sale Price'],
      ['p1', 'One', 5],
      ['', '', ''],
      ['p2'],
    ]);
    assert.deepEqual(rows, [
      { id: 'p1', name_en: 'One', sale_price: 5 },
      { id: 'p2', name_en: undefined, sale_price: undefined },
    ]);
    assert.deepEqual(rowsToObjects([]), []);
  });

  test('the example catalogue file is valid', async () => {
    const source = new JsonCatalogSource(new URL('../../examples/catalog.json', import.meta.url).pathname);
    const c = await source.load();
    assert.ok(c.products.length >= 6);
    assert.ok(c.categories.length >= 3);
    const raw = JSON.parse(readFileSync(new URL('../../examples/catalog.json', import.meta.url), 'utf8'));
    assert.equal(raw.products.length, c.products.length);
  });

  test('the Google Sheets templates use the column names the parser expects', () => {
    const header = (name: string) => readFileSync(new URL(`../../examples/google-sheets/${name}`, import.meta.url), 'utf8').split('\n')[0]!.split(',');
    assert.deepEqual(header('Products.csv'), ['id', 'category', 'name_en', 'name_bn', 'description_en', 'description_bn', 'price', 'sale_price', 'photo', 'stock', 'active', 'sort']);
    assert.deepEqual(header('Categories.csv'), ['id', 'name_en', 'name_bn', 'sort']);
  });

  test('the Orders template header matches the export columns', async () => {
    const { ORDER_COLUMNS } = await import('../src/integrations/sheets-export.js');
    const header = readFileSync(new URL('../../examples/google-sheets/Orders-header.csv', import.meta.url), 'utf8').trim().split(',');
    assert.deepEqual(header, [...ORDER_COLUMNS]);
  });

  test('JsonCatalogSource reports unreadable files', async () => {
    const source = new JsonCatalogSource('/nope.json', async () => {
      throw new Error('ENOENT');
    });
    await assert.rejects(source.load(), /Cannot read catalogue \/nope.json: ENOENT/);
    await assert.rejects(new JsonCatalogSource('x', async () => '{bad').load(), CatalogError);
  });
});

describe('Google Sheets catalogue', () => {
  const fakeSheets = (tabs: Record<string, unknown[][] | Error>): SheetsClient & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      async getValues(id, range) {
        calls.push(`${id}|${range}`);
        const v = tabs[range];
        if (v instanceof Error) throw v;
        return v ?? [];
      },
      async appendValues() {},
    };
  };

  test('reads products and categories tabs', async () => {
    const sheets = fakeSheets({
      'Products!A1:L': [
        ['id', 'category', 'name_en', 'name_bn', 'price', 'sale_price', 'stock', 'active', 'photo'],
        ['tea-1', 'tea', 'Tea', 'চা', '৳৩৫০', '', 10, 'TRUE', 'AgACAgUAAxkBAAIB'],
        ['tea-2', 'tea', 'Old tea', '', 100, '', '', 'FALSE', ''],
      ],
      'Categories!A1:D': [
        ['id', 'name_en', 'name_bn', 'sort'],
        ['tea', 'Tea', 'চা', 1],
      ],
    });
    const c = await new SheetsCatalogSource(sheets, { spreadsheetId: 'sheet123' }).load();
    assert.equal(c.products.length, 2);
    assert.equal(c.products[0]!.price, 350);
    assert.equal(c.products[0]!.photo, 'AgACAgUAAxkBAAIB', 'Telegram file_id accepted');
    assert.equal(c.products[1]!.active, false);
    assert.equal(c.categories[0]!.name.bn, 'চা');
    assert.deepEqual(sheets.calls, ['sheet123|Products!A1:L', 'sheet123|Categories!A1:D']);
  });

  test('a missing Categories tab is fine; other errors are not', async () => {
    const products = [['id', 'category', 'name_en', 'price'], ['a', 'x', 'A', 1]];
    const ok = fakeSheets({ 'Products!A1:L': products, 'Categories!A1:D': new Error('Google Sheets 400: Unable to parse range: Categories!A1:D') });
    assert.equal((await new SheetsCatalogSource(ok, { spreadsheetId: 's' }).load()).categories[0]!.id, 'x');
    const broken = fakeSheets({ 'Products!A1:L': products, 'Categories!A1:D': new Error('Google Sheets 403: forbidden') });
    await assert.rejects(new SheetsCatalogSource(broken, { spreadsheetId: 's' }).load(), /403/);
    const none = fakeSheets({ 'Products!A1:L': products });
    await new SheetsCatalogSource(none, { spreadsheetId: 's', categoriesRange: null }).load();
    assert.deepEqual(none.calls, ['s|Products!A1:L']);
  });

  test('row numbers appear in errors', async () => {
    const sheets = fakeSheets({ 'Products!A1:L': [['id', 'category', 'name_en', 'price'], ['ok', 'x', 'A', 1], ['bad id', 'x', 'B', 1]] });
    await assert.rejects(new SheetsCatalogSource(sheets, { spreadsheetId: 's', categoriesRange: null }).load(), /Products!A1:L row 3/);
  });
});

describe('CatalogService', () => {
  test('caches for the TTL, shares concurrent loads, keeps the last good copy on failure', async () => {
    let now = 0;
    let loads = 0;
    let fail = false;
    const service = new CatalogService(
      {
        name: 't',
        load: async () => {
          loads++;
          if (fail) throw new Error('sheet down');
          return parseCatalogObject({ products: [{ id: `p${loads}`, category: 'c', name_en: 'P', price: 1 }] });
        },
      },
      { ttlMs: 1000, now: () => now },
    );
    await Promise.all([service.get(), service.get(), service.get()]);
    assert.equal(loads, 1);
    now = 500;
    await service.get();
    assert.equal(loads, 1);
    now = 1500;
    assert.equal((await service.get()).products[0]!.id, 'p2');
    fail = true;
    now = 3000;
    assert.equal((await service.get()).products[0]!.id, 'p2', 'stale copy served');
    const fresh = new CatalogService({ name: 'x', load: async () => Promise.reject(new Error('down')) });
    await assert.rejects(fresh.get(), /down/);
  });

  test('categories() hides categories without active products', async () => {
    const service = new CatalogService({
      name: 't',
      load: async () =>
        parseCatalogObject({
          categories: [{ id: 'a', name_en: 'A' }, { id: 'b', name_en: 'B' }],
          products: [{ id: 'p', category: 'a', name_en: 'P', price: 1 }, { id: 'q', category: 'b', name_en: 'Q', price: 1, active: false }],
        }),
    });
    assert.deepEqual((await service.categories()).map((c) => c.id), ['a']);
    assert.equal(await service.product('q'), undefined);
    assert.equal((await service.product('p'))?.id, 'p');
  });
});
