import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/harness.js';
import { commandArgs } from '../src/bot/bot.js';
import { normalizeSearchText, searchProducts } from '../src/catalog/search.js';
import type { Category, Product } from '../src/catalog/types.js';
import { COMMANDS } from '../src/i18n/strings.js';

function product(id: string, en: string, bn = '', extra: Partial<Product> = {}): Product {
  return {
    id,
    categoryId: 'c1',
    name: { en, bn },
    description: { en: '', bn: '' },
    price: 100,
    active: true,
    sort: 0,
    ...extra,
  };
}

const categories: Category[] = [{ id: 'c1', name: { en: 'Sarees', bn: 'শাড়ি' }, sort: 0 }];

describe('search matching', () => {
  test('normalizeSearchText lower-cases, converts digits and drops punctuation', () => {
    assert.equal(normalizeSearchText('  Sylhet TEA, ৫০০g! '), 'sylhet tea 500g');
    assert.equal(normalizeSearchText('ঢাকাই-জামদানি'), 'ঢাকাই জামদানি');
  });

  test('every word must match; names rank above descriptions', () => {
    const products = [
      product('a', 'Cotton Saree', '', { description: { en: 'Red border', bn: '' } }),
      product('b', 'Red Silk Saree'),
      product('c', 'Blue Silk Saree'),
    ];
    assert.deepEqual(
      searchProducts(products, categories, 'red saree').map((r) => r.product.id),
      ['b', 'a'],
    );
    assert.deepEqual(searchProducts(products, categories, 'silk').map((r) => r.product.id), ['c', 'b'], 'ties sort by name');
  });

  test('matches Bangla names, category names, ids and Bangla digits', () => {
    const products = [product('tea-500', 'Sylhet Tea 500g', 'সিলেটের চা ৫০০ গ্রাম'), product('j1', 'Jamdani', 'জামদানি')];
    assert.deepEqual(searchProducts(products, categories, 'জামদানি').map((r) => r.product.id), ['j1']);
    assert.deepEqual(searchProducts(products, categories, 'চা 500').map((r) => r.product.id), ['tea-500']);
    assert.deepEqual(searchProducts(products, categories, 'শাড়ি').length, 2, 'category name');
    assert.deepEqual(searchProducts(products, categories, 'tea-500').map((r) => r.product.id), ['tea-500']);
  });

  test('inactive products and empty queries give nothing', () => {
    const products = [product('x', 'Hidden', '', { active: false })];
    assert.deepEqual(searchProducts(products, categories, 'hidden'), []);
    assert.deepEqual(searchProducts([product('y', 'Thing')], categories, ' !!! '), []);
  });

  test('commandArgs returns the text after the command', () => {
    assert.equal(commandArgs('/search red saree'), 'red saree');
    assert.equal(commandArgs('/search@test_shop_bot  চা '), 'চা');
    assert.equal(commandArgs('/search'), '');
    assert.equal(commandArgs('hello'), '');
  });

  test('search is registered as a bot command in both languages', () => {
    assert.ok(COMMANDS.en.some((c) => c.command === 'search'));
    assert.ok(COMMANDS.bn.some((c) => c.command === 'search'));
  });
});

describe('search in the bot', () => {
  test('/search lists matching products as buttons', async () => {
    const h = createHarness();
    await h.text('/search jamdani');
    const msg = h.api.last('sendMessage')!;
    assert.match(String(msg.text), /Results for “jamdani”/);
    assert.match(String(msg.text), /1 product\(s\) found/);
    assert.deepEqual(h.buttons(msg.reply_markup), ['p:jamdani-01', 'c', 'cart']);
  });

  test('free text outside checkout searches, in Bangla too', async () => {
    const h = createHarness();
    await h.text('চা', h.user(7, { language_code: 'bn' }));
    const msg = h.api.last('sendMessage')!;
    assert.match(String(msg.text), /ফলাফল/);
    const kb = h.buttons(msg.reply_markup);
    assert.ok(kb.includes('p:tea-500') && kb.includes('p:tea-gift'));
    assert.ok(!kb.includes('p:old-item'), 'inactive products are hidden');
  });

  test('no match explains how to browse and escapes the query', async () => {
    const h = createHarness();
    await h.text('<b>nothing</b>');
    const text = String(h.api.last('sendMessage')!.text);
    assert.match(text, /No products match <b>&lt;b&gt;nothing&lt;\/b&gt;<\/b>/);
    assert.match(text, /Tap \/shop/);
  });

  test('/search without words shows the usage; one character is not searched', async () => {
    const h = createHarness();
    await h.text('/search');
    assert.match(h.lastText(), /Send a product name to search/);
    await h.text('x');
    assert.match(h.lastText(), /Tap \/shop/);
  });

  test('many results are capped with a hint', async () => {
    const products = Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, category: 'c1', name_en: `Cotton item ${i}`, price: 100 + i }));
    const h = createHarness({ catalog: { categories: [{ id: 'c1', name_en: 'All' }], products } });
    await h.text('cotton');
    const msg = h.api.last('sendMessage')!;
    assert.match(String(msg.text), /14 product\(s\) found/);
    assert.match(String(msg.text), /Showing the first 10/);
    assert.equal(h.buttons(msg.reply_markup).filter((d) => d.startsWith('p:')).length, 10);
  });

  test('text during checkout is still checkout input, not a search', async () => {
    const h = createHarness();
    await h.press('a:tea-500');
    await h.press('co');
    await h.text('Rahim Uddin');
    assert.doesNotMatch(h.lastText(), /Results for|No products match/);
  });
});
