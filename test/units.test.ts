import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { changeQty, priceCart, roundTaka, setQty, MAX_QTY_PER_ITEM } from '../src/shop/cart.js';
import { deliveryFee, DEFAULT_DELIVERY } from '../src/shop/delivery.js';
import { canTransition, generateOrderId, nextActions, ORDER_ID_RE } from '../src/shop/orders.js';
import { cleanText, validateAddress, validateBkashTrxId, validateName } from '../src/shop/validate.js';
import { button, chunk, escapeHtml, truncate, utf8Length } from '../src/telegram/format.js';
import { allKeys, t } from '../src/i18n/strings.js';
import { CB, adminOrderScreen, productCaption } from '../src/bot/views.js';
import type { Product } from '../src/catalog/types.js';
import { createLogger } from '../src/logger.js';

const P = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  categoryId: 'c',
  name: { en: 'Thing', bn: 'জিনিস' },
  description: { en: '', bn: '' },
  price: 100,
  active: true,
  sort: 0,
  ...over,
});

describe('cart maths', () => {
  test('changeQty adds, removes and respects limits', () => {
    let r = changeQty([], P(), 1);
    assert.ok(r.ok);
    assert.deepEqual(r.items, [{ productId: 'p1', qty: 1 }]);
    r = changeQty(r.items, P(), -1);
    assert.ok(r.ok && r.items.length === 0);
    assert.deepEqual(changeQty([], P({ stock: 0 }), 1), { ok: false, reason: 'out-of-stock' });
    assert.deepEqual(changeQty([{ productId: 'p1', qty: 2 }], P({ stock: 2 }), 1), { ok: false, reason: 'stock-limit', limit: 2 });
    assert.deepEqual(changeQty([{ productId: 'p1', qty: MAX_QTY_PER_ITEM }], P(), 1), { ok: false, reason: 'max-qty', limit: MAX_QTY_PER_ITEM });
    const full = Array.from({ length: 30 }, (_, i) => ({ productId: `x${i}`, qty: 1 }));
    assert.deepEqual(changeQty(full, P(), 1), { ok: false, reason: 'cart-full', limit: 30 });
    assert.ok(changeQty([{ productId: 'p1', qty: 5 }], P({ stock: 2 }), -1).ok, 'removing is always allowed');
  });

  test('setQty keeps order', () => {
    const items = [{ productId: 'a', qty: 1 }, { productId: 'b', qty: 1 }];
    assert.deepEqual(setQty(items, 'a', 3), [{ productId: 'a', qty: 3 }, { productId: 'b', qty: 1 }]);
    assert.deepEqual(setQty(items, 'c', 1).map((i) => i.productId), ['a', 'b', 'c']);
    assert.deepEqual(setQty(items, 'a', 0), [{ productId: 'b', qty: 1 }]);
  });

  test('priceCart uses sale prices and flags missing and over-stock lines', () => {
    const products: Record<string, Product> = {
      a: P({ id: 'a', price: 100, salePrice: 80 }),
      b: P({ id: 'b', price: 0.1, stock: 1 }),
      off: P({ id: 'off', active: false }),
    };
    const priced = priceCart(
      [{ productId: 'a', qty: 2 }, { productId: 'b', qty: 3 }, { productId: 'gone', qty: 1 }, { productId: 'off', qty: 1 }],
      (id) => products[id],
    );
    assert.equal(priced.subtotal, 160.3);
    assert.equal(priced.count, 5);
    assert.deepEqual(priced.missing, ['gone', 'off']);
    assert.deepEqual(priced.overStock, ['b']);
    assert.equal(roundTaka(0.1 + 0.2), 0.3);
  });
});

describe('delivery fees', () => {
  test('inside/outside Dhaka and free threshold', () => {
    assert.deepEqual(deliveryFee('dhaka', 500, DEFAULT_DELIVERY), { zone: 'inside', fee: 70 });
    assert.deepEqual(deliveryFee('rangpur', 500, DEFAULT_DELIVERY), { zone: 'outside', fee: 130 });
    const cfg = { ...DEFAULT_DELIVERY, insideDistricts: ['dhaka', 'gazipur'], freeAbove: 2000 };
    assert.deepEqual(deliveryFee('gazipur', 1999, cfg), { zone: 'inside', fee: 70 });
    assert.deepEqual(deliveryFee('sylhet', 2000, cfg), { zone: 'outside', fee: 0 });
  });
});

describe('orders', () => {
  test('status transitions', () => {
    assert.ok(canTransition('pending', 'confirmed'));
    assert.ok(canTransition('confirmed', 'shipped'));
    assert.ok(canTransition('shipped', 'delivered'));
    assert.ok(canTransition('shipped', 'cancelled'));
    assert.ok(!canTransition('pending', 'shipped'));
    assert.ok(!canTransition('delivered', 'cancelled'));
    assert.ok(!canTransition('cancelled', 'confirmed'));
    assert.deepEqual(nextActions('pending'), ['confirm', 'cancel']);
    assert.deepEqual(nextActions('confirmed'), ['ship', 'cancel']);
    assert.deepEqual(nextActions('shipped'), ['deliver', 'cancel']);
    assert.deepEqual(nextActions('delivered'), []);
  });

  test('order ids use the Dhaka date and a readable alphabet', () => {
    // 20:00 UTC on 14 Nov is already 15 Nov in Dhaka.
    const id = generateOrderId(new Date('2026-11-14T20:00:00Z'), () => 0);
    assert.equal(id, 'ORD-261115-2222');
    for (let i = 0; i < 200; i++) assert.match(generateOrderId(), ORDER_ID_RE);
  });
});

describe('input validation', () => {
  test('names', () => {
    assert.equal(validateName('  Rahim   Uddin '), 'Rahim Uddin');
    assert.equal(validateName('রহিম উদ্দিন'), 'রহিম উদ্দিন');
    assert.equal(validateName('R'), null);
    assert.equal(validateName('12345'), null);
    assert.equal(validateName('Rahim 01712345678'), null);
    assert.equal(validateName('visit https://x.y'), null);
    assert.equal(validateName('x'.repeat(61)), null);
  });

  test('addresses', () => {
    assert.equal(validateAddress('House 12,\nRoad 5,\tDhanmondi'), 'House 12, Road 5, Dhanmondi');
    assert.equal(validateAddress('too short'), null);
    assert.equal(validateAddress('a'.repeat(301)), null);
    assert.equal(validateAddress('see www.example.com for my address'), null);
  });

  test('bKash TrxIDs', () => {
    assert.equal(validateBkashTrxId('9c7d6e5f4g'), '9C7D6E5F4G');
    assert.equal(validateBkashTrxId('TrxID: 8N7A6D5EE7'), '8N7A6D5EE7');
    assert.equal(validateBkashTrxId('trx id 8N7A 6D5E E7'), '8N7A6D5EE7');
    assert.equal(validateBkashTrxId('ABCDEFGHIJ'), null, 'needs a digit');
    assert.equal(validateBkashTrxId('1234567890'), null, 'needs a letter');
    assert.equal(validateBkashTrxId('AB12'), null);
    assert.equal(validateBkashTrxId('AB12-CD34-EF'), null);
  });

  test('cleanText strips control and bidi characters', () => {
    assert.equal(cleanText('a\u0000b‮c​d'), 'a b c d');
  });
});

describe('Telegram formatting helpers', () => {
  test('escapeHtml', () => {
    assert.equal(escapeHtml('<b>"A&B"</b>'), '&lt;b&gt;"A&amp;B"&lt;/b&gt;');
  });

  test('button enforces the 64-byte callback_data limit (bytes, not characters)', () => {
    assert.deepEqual(button('x', 'a'.repeat(64)), { text: 'x', callback_data: 'a'.repeat(64) });
    assert.throws(() => button('x', 'a'.repeat(65)), RangeError);
    assert.throws(() => button('x', 'ক'.repeat(22)), RangeError); // 66 bytes
    assert.throws(() => button('x', ''), RangeError);
    assert.equal(utf8Length('ক'), 3);
  });

  test('every callback the bot builds fits in 64 bytes for 32-char ids', () => {
    const id = 'x'.repeat(32);
    const all = [CB.category(id, 999), CB.product(id), CB.add(id), CB.remove(id), CB.cartInc(id), CB.cartDec(id), CB.cartDel(id), CB.division('mymensingh'), CB.district('chapainawabganj'), CB.admin('ORD-261115-ABCD', 'deliver')];
    for (const d of all) assert.ok(utf8Length(d) <= 64, d);
  });

  test('chunk and truncate', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.equal(truncate('abcdef', 4), 'abc…');
    assert.equal(truncate('abc', 4), 'abc');
    assert.equal(truncate('বাংলাদেশ', 3).length <= 3, true);
  });

  test('product captions stay within 1024 characters', () => {
    const caption = productCaption('en', P({ description: { en: 'long text '.repeat(500), bn: '' } }));
    assert.ok([...caption].length <= 1024);
    assert.ok(caption.endsWith('…'));
  });

  test('admin message for a huge order stays within 4096 characters', () => {
    const at = '2026-11-15T06:00:00.000Z';
    const screen = adminOrderScreen({
      id: 'ORD-261115-A2B3', userId: 1, chatId: 1, lang: 'en', status: 'pending',
      lines: Array.from({ length: 30 }, (_, i) => ({ productId: `p${i}`, name: 'Very long product name '.repeat(8), unitPrice: 1, qty: 1, total: 1 })),
      subtotal: 30, deliveryFee: 70, total: 100, zone: 'inside',
      customer: { name: 'A', phone: '01712345678', districtId: 'dhaka', district: 'Dhaka', address: 'x'.repeat(300) },
      payment: { method: 'cod' }, createdAt: at, updatedAt: at, history: [],
    });
    assert.ok([...screen.text].length <= 4096);
  });
});

describe('i18n', () => {
  test('Bangla has every English key', () => {
    assert.deepEqual(allKeys('bn').sort(), allKeys('en').sort());
  });

  test('placeholders are filled; numbers use Bangla digits in Bangla', () => {
    assert.equal(t('en', 'cart.limit', { stock: 3 }), 'Only 3 available.');
    assert.equal(t('bn', 'cart.limit', { stock: 3 }), 'মাত্র ৩টি আছে।');
    assert.equal(t('en', 'cart.limit'), 'Only {stock} available.', 'missing params stay visible');
  });

  test('every placeholder in Bangla also exists in English', () => {
    for (const key of allKeys('en')) {
      const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(names(t('bn', key as never)), names(t('en', key as never)), key);
    }
  });
});

describe('logger', () => {
  test('writes JSON lines at or above the level', () => {
    const lines: string[] = [];
    const log = createLogger('warn', (l) => void lines.push(l));
    log.info('hidden');
    log.warn('shown', { orderId: 'ORD-1' });
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.level, 'warn');
    assert.equal(parsed.orderId, 'ORD-1');
  });
});
