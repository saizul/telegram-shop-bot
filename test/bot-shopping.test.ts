import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, ADMIN_CHAT } from './helpers/harness.js';
import { commandOf } from '../src/bot/bot.js';

describe('browsing and cart', () => {
  test('/start shows the welcome menu with escaped shop name', async () => {
    const h = createHarness();
    await h.text('/start');
    const msg = h.api.last('sendMessage')!;
    assert.match(String(msg.text), /Welcome to Test &lt;Shop&gt;!/);
    assert.equal(msg.parse_mode, 'HTML');
    assert.deepEqual(h.buttons(msg.reply_markup), ['c', 'cart', 'mo', 'l:bn', 'mh']);
  });

  test('Bangla is picked from the Telegram language code', async () => {
    const h = createHarness();
    await h.text('/start', h.user(7, { language_code: 'bn' }));
    assert.match(String(h.api.last('sendMessage')!.text), /স্বাগতম/);
    assert.equal((await h.store.getSession(7))?.lang, 'bn');
  });

  test('/shop lists categories with active products only', async () => {
    const h = createHarness();
    await h.text('/shop');
    const msg = h.api.last('sendMessage')!;
    assert.deepEqual(h.buttons(msg.reply_markup), ['c:saree:0', 'c:tea:0', 'm']);
  });

  test('category page lists products with prices and marks out-of-stock items', async () => {
    const h = createHarness();
    await h.press('c:tea:0');
    const edit = h.api.last('editMessageText')!;
    assert.match(String(edit.text), /<b>Tea<\/b>/);
    const labels = (edit.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }).inline_keyboard.flat();
    assert.ok(labels.some((b) => b.callback_data === 'p:tea-500' && b.text.includes('৳350')));
    assert.ok(labels.some((b) => b.callback_data === 'p:tea-gift' && b.text.endsWith('✖')));
    assert.ok(!labels.some((b) => b.callback_data === 'p:old-item'), 'inactive products are hidden');
  });

  test('category pagination', async () => {
    const products = Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, category: 'c1', name_en: `Item ${i}`, price: 100 + i }));
    const h = createHarness({ catalog: { categories: [{ id: 'c1', name_en: 'All' }], products } });
    await h.press('c:c1:0');
    let kb = h.buttons(h.api.last('editMessageText')!.reply_markup);
    assert.ok(kb.includes('c:c1:1') && !kb.includes('c:c1:-1'));
    assert.match(String(h.api.last('editMessageText')!.text), /Page 1 of 3/);
    await h.press('c:c1:2');
    kb = h.buttons(h.api.last('editMessageText')!.reply_markup);
    assert.deepEqual(kb.filter((d) => d.startsWith('p:')), ['p:p12', 'p:p13']);
    assert.ok(kb.includes('c:c1:1') && !kb.includes('c:c1:3'));
    await h.press('c:c1:99'); // clamps to the last page
    assert.match(String(h.api.last('editMessageText')!.text), /Page 3 of 3/);
  });

  test('product card is a photo with caption, sale price and stock', async () => {
    const h = createHarness();
    await h.press('p:jamdani-01');
    const photo = h.api.last('sendPhoto')!;
    assert.equal(photo.photo, 'https://example.com/jamdani.jpg');
    assert.match(String(photo.caption), /<s>৳4,500<\/s> <b>৳3,990<\/b>/);
    assert.match(String(photo.caption), /In stock: 3/);
    assert.deepEqual(h.buttons(photo.reply_markup), ['a:jamdani-01', 'c:saree:0', 'cart']);
    assert.equal(h.api.of('deleteMessage').length, 1, 'text list replaced by photo');
  });

  test('product without photo is sent as text; broken photo falls back to text', async () => {
    const h = createHarness();
    await h.press('p:tangail-02');
    assert.equal(h.api.of('sendPhoto').length, 0);
    assert.match(String(h.api.last('editMessageText')!.text), /Tangail Tant/);
    h.api.failNext('sendPhoto');
    await h.press('p:jamdani-01');
    assert.match(String(h.api.last('sendMessage')!.text), /Dhakai Jamdani/);
  });

  test('add to cart updates the product keyboard and answers the callback', async () => {
    const h = createHarness();
    await h.press('a:jamdani-01');
    assert.match(String(h.api.last('answerCallbackQuery')!.text), /Added to cart: Dhakai Jamdani/);
    assert.deepEqual(h.buttons(h.api.last('editMessageReplyMarkup')!.reply_markup), ['r:jamdani-01', 'cart', 'a:jamdani-01', 'c:saree:0', 'cart']);
    assert.deepEqual(await h.store.getCart(42), [{ productId: 'jamdani-01', qty: 1 }]);
    await h.press('r:jamdani-01');
    assert.deepEqual(await h.store.getCart(42), []);
  });

  test('stock limits are enforced with an alert', async () => {
    const h = createHarness();
    for (let i = 0; i < 3; i++) await h.press('a:jamdani-01');
    await h.press('a:jamdani-01');
    const ans = h.api.last('answerCallbackQuery')!;
    assert.equal(ans.show_alert, true);
    assert.match(String(ans.text), /Only 3 available/);
    assert.deepEqual(await h.store.getCart(42), [{ productId: 'jamdani-01', qty: 3 }]);
    await h.press('a:tea-gift');
    assert.match(String(h.api.last('answerCallbackQuery')!.text), /Out of stock/);
  });

  test('cart view: totals, +/-/remove/clear', async () => {
    const h = createHarness();
    await h.press('a:jamdani-01');
    await h.press('a:tea-500');
    await h.press('a:tea-500');
    await h.press('cart');
    let text = String(h.api.last('editMessageText')!.text);
    assert.match(text, /1 × Dhakai Jamdani: ৳3,990/);
    assert.match(text, /2 × Sylhet Tea 500g: ৳700/);
    assert.match(text, /Subtotal: <b>৳4,690<\/b>/);
    await h.press('ci:tea-500');
    assert.match(String(h.api.last('editMessageText')!.text), /3 × Sylhet Tea/);
    await h.press('cd:tea-500');
    await h.press('cr:jamdani-01');
    text = String(h.api.last('editMessageText')!.text);
    assert.doesNotMatch(text, /Jamdani/);
    await h.press('cc');
    assert.match(String(h.api.last('editMessageText')!.text), /Your cart is empty/);
  });

  test('cart drops products removed from the catalogue', async () => {
    const h = createHarness();
    await h.press('a:tangail-02');
    await h.press('a:tea-500');
    await h.setCatalog({ ...structuredClone((await import('./helpers/harness.js')).CATALOG), products: [{ id: 'tea-500', category: 'tea', name_en: 'Tea', price: 350 }] });
    await h.text('/cart');
    assert.doesNotMatch(String(h.api.last('sendMessage')!.text), /Tangail/);
    assert.deepEqual(await h.store.getCart(42), [{ productId: 'tea-500', qty: 1 }]);
  });

  test('language switch translates the menu and prices', async () => {
    const h = createHarness();
    await h.press('l:bn');
    assert.match(String(h.api.last('answerCallbackQuery')!.text), /ভাষা বাংলা/);
    await h.press('p:tea-500');
    assert.match(String(h.api.last('editMessageText')!.text), /দাম: <b>৳৩৫০<\/b>/);
    await h.text('/language');
    assert.match(String(h.api.last('sendMessage')!.text), /Language set to English/);
  });

  test('every callback query is answered exactly once', async () => {
    const h = createHarness();
    for (const data of ['c', 'c:saree:0', 'p:tangail-02', 'a:tangail-02', 'cart', 'mh', 'mo', 'm', 'noop', 'zzz', 'p:missing']) {
      h.api.reset();
      await h.press(data);
      assert.equal(h.api.of('answerCallbackQuery').length, 1, data);
    }
  });

  test('unknown product shows an alert', async () => {
    const h = createHarness();
    await h.press('p:does-not-exist');
    assert.equal(h.api.last('answerCallbackQuery')!.show_alert, true);
  });

  test('free text outside checkout gets a hint with the menu', async () => {
    const h = createHarness();
    await h.text('hello?');
    assert.match(String(h.api.last('sendMessage')!.text), /Tap \/shop/);
  });

  test('/help, /orders (empty) and unknown commands', async () => {
    const h = createHarness();
    await h.text('/help');
    assert.match(h.lastText(), /How to order/);
    await h.text('/orders');
    assert.match(h.lastText(), /no orders yet/);
    await h.text('/whatever');
    assert.match(h.lastText(), /Tap \/shop/);
  });

  test('/chatid in a group reports the chat id; other group chatter is ignored', async () => {
    const h = createHarness();
    await h.group('/chatid@test_shop_bot');
    assert.match(h.lastText(), new RegExp(`Chat ID: <code>${ADMIN_CHAT}</code>`));
    h.api.reset();
    await h.group('hello everyone');
    assert.equal(h.api.calls.length, 0);
  });

  test('bots and duplicate update ids are ignored', async () => {
    const h = createHarness();
    const update = await h.text('/start');
    h.api.reset();
    await h.raw(update);
    assert.equal(h.api.calls.length, 0);
    await h.text('/start', h.user(5, { is_bot: true }));
    assert.equal(h.api.calls.length, 0);
  });

  test('a failing API call produces a friendly error instead of a crash', async () => {
    const h = createHarness();
    h.api.failNext('editMessageText', new Error('network down'));
    h.api.failNext('sendMessage', new Error('network down'));
    await h.press('c');
    // The error handler answers the callback with the generic error.
    assert.match(String(h.api.last('answerCallbackQuery')!.text), /Something went wrong/);
  });

  test('commandOf parses commands with bot mentions and arguments', () => {
    assert.equal(commandOf('/start'), 'start');
    assert.equal(commandOf('/Start@MyShopBot payload'), 'start');
    assert.equal(commandOf('start'), undefined);
    assert.equal(commandOf('/'), undefined);
    assert.equal(commandOf(undefined), undefined);
  });
});
