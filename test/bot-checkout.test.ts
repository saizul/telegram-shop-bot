import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_CHAT, ADMIN_USER, createHarness } from './helpers/harness.js';

describe('checkout', () => {
  test('full COD checkout inside Dhaka', async () => {
    const h = createHarness();
    const summary = await h.checkoutCod();
    assert.match(summary, /Please confirm your order/);
    assert.match(summary, /1 × Tangail Tant: ৳1,850/);
    assert.match(summary, /Delivery \(inside Dhaka\): ৳70/);
    assert.match(summary, /Total: ৳1,920/);
    assert.match(summary, /<b>Phone:<\/b> 01712345678/);
    assert.match(summary, /Cash on delivery/);

    await h.press('ok');
    const order = await h.store.getOrder('ORD-261115-A2B3');
    assert.ok(order);
    assert.equal(order.status, 'pending');
    assert.equal(order.total, 1920);
    assert.equal(order.customer.district, 'Dhaka');
    assert.equal(order.zone, 'inside');
    assert.deepEqual(order.payment, { method: 'cod' });
    assert.equal(order.username, 'rahim');
    assert.deepEqual(await h.store.getCart(42), [], 'cart cleared');

    const placed = h.api.of('sendMessage').find((m) => String(m.text).includes('has been placed'))!;
    assert.match(String(placed.text), /ORD-261115-A2B3/);

    const admin = h.api.of('sendMessage').find((m) => m.chat_id === ADMIN_CHAT)!;
    assert.match(String(admin.text), /Order ORD-261115-A2B3<\/b>: <b>PENDING/);
    assert.match(String(admin.text), /<code>01712345678<\/code>/);
    assert.deepEqual(h.buttons(admin.reply_markup), ['o:ORD-261115-A2B3:confirm', 'o:ORD-261115-A2B3:cancel']);
    assert.ok(order.adminMessage, 'admin message id saved');

    assert.equal(h.sink.events.length, 1);
    assert.equal(h.sink.events[0]!.type, 'order.created');

    const session = await h.store.getSession(42);
    assert.equal(session?.checkout, undefined);
    assert.deepEqual(session?.profile, { name: 'Rahim Uddin', phone: '01712345678', districtId: 'dhaka', address: 'House 12, Road 5, Dhanmondi, Dhaka' });
  });

  test('outside Dhaka uses the outside fee', async () => {
    const h = createHarness();
    const summary = await h.checkoutCod({ district: 'gazipur' });
    assert.match(summary, /Delivery \(outside Dhaka\): ৳130/);
    assert.match(summary, /Total: ৳1,980/);
  });

  test('free delivery above the threshold', async () => {
    const h = createHarness({ config: { delivery: { insideFee: 70, outsideFee: 130, insideDistricts: ['dhaka'], freeAbove: 1500 } } });
    const summary = await h.checkoutCod();
    assert.match(summary, /Delivery \(inside Dhaka\): free/);
    assert.match(summary, /Total: ৳1,850/);
  });

  test('phone step asks for contact sharing and validates numbers', async () => {
    const h = createHarness();
    await h.press('a:tangail-02');
    await h.press('co');
    assert.match(h.lastText(), /full name/);
    await h.text('R');
    assert.match(h.lastText(), /2 to 60 letters/);
    await h.text('Rahim Uddin');
    const ask = h.api.last('sendMessage')!;
    assert.deepEqual(ask.reply_markup, {
      keyboard: [[{ text: '📱 Share my number', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    await h.text('12345');
    assert.match(h.lastText(), /does not look like a Bangladeshi mobile number/);
    await h.contact('+8801812345678');
    const removeKb = h.api.of('sendMessage').find((m) => String(m.text) === '📱 01812345678');
    assert.deepEqual(removeKb?.reply_markup, { remove_keyboard: true });
    assert.match(h.lastText(), /Choose your <b>division<\/b>/);
  });

  test("someone else's shared contact is not accepted", async () => {
    const h = createHarness();
    await h.press('a:tangail-02');
    await h.press('co');
    await h.text('Rahim Uddin');
    await h.contact('+8801812345678', h.user(), 777);
    assert.match(h.lastText(), /does not look like/);
  });

  test('district by typing (Bangla or old spelling), division navigation', async () => {
    const h = createHarness();
    await h.press('a:tangail-02');
    await h.press('co');
    await h.text('Rahim Uddin');
    await h.text('০১৭১২৩৪৫৬৭৮');
    await h.press('dv:chattogram');
    const districts = h.buttons(h.api.last('editMessageText')!.reply_markup);
    assert.ok(districts.includes('dd:coxsbazar'));
    assert.ok(districts.includes('dvb'));
    await h.press('dvb');
    assert.match(String(h.api.last('editMessageText')!.text), /division/);
    await h.text('Narnia');
    assert.match(h.lastText(), /District not found/);
    await h.text('Chittagong');
    assert.match(h.lastText(), /full delivery address/);
    assert.equal((await h.store.getSession(42))?.checkout?.districtId, 'chattogram');
  });

  test('address validation', async () => {
    const h = createHarness();
    await h.press('a:tangail-02');
    await h.press('co');
    await h.text('Rahim Uddin');
    await h.text('01712345678');
    await h.text('Dhaka');
    await h.text('short');
    assert.match(h.lastText(), /10 to 300 characters/);
    await h.text('visit https://spam.example.com now please');
    assert.match(h.lastText(), /10 to 300 characters/);
    await h.text('Flat 3B, House 7, Road 2, Mirpur 10');
    assert.match(h.lastText(), /Payment method/);
    assert.deepEqual(h.buttons(h.api.last('sendMessage')!.reply_markup), ['pm:cod', 'pm:bkash', 'x']);
  });

  test('bKash flow records a validated TrxID', async () => {
    const h = createHarness();
    await h.press('a:tangail-02');
    await h.press('co');
    await h.text('Karim');
    await h.text('01912345678');
    await h.text('Sylhet');
    await h.text('Zindabazar, Sylhet Sadar, Sylhet');
    await h.press('pm:bkash');
    const ask = String(h.api.last('editMessageText')!.text);
    assert.match(ask, /<code>01711000000<\/code>/);
    assert.match(ask, /৳1,980/);
    await h.text('hello');
    assert.match(h.lastText(), /TrxID has 8 to 12/);
    await h.text('trxid: 9c7d6e5f4g');
    assert.match(h.lastText(), /bKash \(TrxID 9C7D6E5F4G\)/);
    await h.press('ok');
    const order = await h.store.getOrder('ORD-261115-A2B3');
    assert.deepEqual(order?.payment, { method: 'bkash', bkashTrxId: '9C7D6E5F4G' });
    const admin = h.api.of('sendMessage').find((m) => m.chat_id === ADMIN_CHAT)!;
    assert.match(String(admin.text), /bKash, TrxID <code>9C7D6E5F4G<\/code>/);
  });

  test('bKash button is hidden when no bKash number is configured', async () => {
    const h = createHarness({ config: { bkashNumber: undefined as unknown as string } });
    await h.press('a:tangail-02');
    await h.press('co');
    await h.text('Karim');
    await h.text('01912345678');
    await h.text('Dhaka');
    await h.text('Zindabazar Road, Dhaka 1207');
    assert.deepEqual(h.buttons(h.api.last('sendMessage')!.reply_markup), ['pm:cod', 'x']);
  });

  test('saved profile is offered on the next checkout', async () => {
    const h = createHarness();
    await h.checkoutCod();
    await h.press('ok');
    await h.press('a:tea-500');
    await h.press('co');
    const offer = h.api.last('sendMessage')!;
    assert.match(String(offer.text), /Use your saved details/);
    assert.deepEqual(h.buttons(offer.reply_markup), ['cp:use', 'cp:new', 'x']);
    await h.press('cp:use');
    assert.match(String(h.api.last('editMessageText')!.text), /Payment method/);
    await h.press('pm:cod');
    await h.press('ok');
    const second = await h.store.getOrder('ORD-261115-C4D5');
    assert.equal(second?.customer.name, 'Rahim Uddin');
    assert.equal(second?.total, 350 + 70);
    // Enter new details path
    await h.press('a:tea-500');
    await h.press('co');
    await h.press('cp:new');
    assert.match(String(h.api.last('editMessageText')!.text), /full name/);
  });

  test('checkout with an empty cart is refused', async () => {
    const h = createHarness();
    await h.press('co');
    assert.match(String(h.api.last('answerCallbackQuery')!.text), /cart is empty/);
    assert.equal((await h.store.getSession(42))?.checkout, undefined);
  });

  test('cancel by button and by /cancel', async () => {
    const h = createHarness();
    await h.press('a:tangail-02');
    await h.press('co');
    await h.press('x');
    assert.match(h.lastText(), /Checkout cancelled/);
    assert.equal((await h.store.getSession(42))?.checkout, undefined);
    assert.deepEqual(await h.store.getCart(42), [{ productId: 'tangail-02', qty: 1 }], 'cart kept');
    await h.press('co');
    await h.text('/cancel');
    assert.match(h.lastText(), /Checkout cancelled/);
    await h.text('/cancel');
    assert.match(h.lastText(), /no checkout in progress/);
  });

  test('stale buttons after checkout ends are rejected', async () => {
    const h = createHarness();
    await h.press('dd:dhaka');
    assert.match(String(h.api.last('answerCallbackQuery')!.text), /expired/);
    await h.press('pm:cod');
    await h.press('ok');
    await h.press('cp:use');
    assert.equal(await h.store.getOrder('ORD-261115-A2B3'), undefined);
  });

  test('checkout expires after two hours', async () => {
    let now = new Date('2026-11-15T06:00:00Z').getTime();
    const h = createHarness({ now: () => new Date(now) });
    await h.press('a:tangail-02');
    await h.press('co');
    now += 3 * 3600_000;
    await h.text('Rahim Uddin');
    assert.match(h.lastText(), /checkout has expired/);
    assert.equal((await h.store.getSession(42))?.checkout, undefined);
  });

  test('stock that ran out during checkout blocks the order', async () => {
    const h = createHarness();
    await h.press('a:jamdani-01');
    await h.press('a:jamdani-01');
    await h.press('co');
    await h.text('Rahim Uddin');
    await h.text('01712345678');
    await h.text('Dhaka');
    await h.text('House 12, Road 5, Dhanmondi');
    await h.press('pm:cod');
    const { CATALOG } = await import('./helpers/harness.js');
    const changed = structuredClone(CATALOG);
    changed.products[0]!.stock = 1;
    await h.setCatalog(changed);
    await h.press('ok');
    assert.match(String(h.api.last('answerCallbackQuery')!.text), /no longer available/);
    assert.equal(await h.store.getOrder('ORD-261115-A2B3'), undefined);
  });

  test('order still succeeds when the admin notification fails', async () => {
    const h = createHarness();
    await h.checkoutCod();
    // Fail the admin message (the second sendMessage after confirming).
    const original = h.api.sendMessage.bind(h.api);
    h.api.sendMessage = async (p) => {
      if (p.chat_id === ADMIN_CHAT) throw new Error('bot was kicked from the group');
      return original(p);
    };
    await h.press('ok');
    const order = await h.store.getOrder('ORD-261115-A2B3');
    assert.ok(order);
    assert.equal(order.adminMessage, undefined);
    assert.equal(h.sink.events.length, 1);
  });

  test('Bangla checkout texts use Bangla digits', async () => {
    const h = createHarness();
    await h.press('l:bn');
    const summary = await h.checkoutCod();
    assert.match(summary, /অর্ডারটি নিশ্চিত করুন/);
    assert.match(summary, /সর্বমোট: ৳১,৯২০/);
    assert.match(summary, /ঢাকার ভেতরে/);
    await h.press('ok');
    assert.equal((await h.store.getOrder('ORD-261115-A2B3'))?.lang, 'bn');
  });

  test('HTML in customer input is escaped everywhere', async () => {
    const h = createHarness();
    await h.press('a:tangail-02');
    await h.press('co');
    await h.text('Rahim <b>Boss</b>');
    await h.text('01712345678');
    await h.text('Dhaka');
    await h.text('House <script>alert(1)</script> Road 5');
    await h.press('pm:cod');
    const summary = h.lastText();
    assert.match(summary, /Rahim &lt;b&gt;Boss&lt;\/b&gt;/);
    assert.doesNotMatch(summary, /<script>/);
    await h.press('ok');
    const admin = h.api.of('sendMessage').find((m) => m.chat_id === ADMIN_CHAT)!;
    assert.doesNotMatch(String(admin.text), /<script>|<b>Boss/);
  });
});

describe('admin order actions', () => {
  async function placed() {
    const h = createHarness();
    await h.checkoutCod();
    await h.press('ok');
    const order = (await h.store.getOrder('ORD-261115-A2B3'))!;
    const adminMsg = { message_id: order.adminMessage!.messageId, date: 0, chat: { id: ADMIN_CHAT, type: 'supergroup' as const }, text: 'order' };
    const admin = h.user(ADMIN_USER, { first_name: 'Admin <Ops>', username: 'ops' });
    return { h, adminMsg, admin };
  }

  test('confirm → ship → deliver notifies the customer each time', async () => {
    const { h, adminMsg, admin } = await placed();
    h.api.reset();
    await h.press('o:ORD-261115-A2B3:confirm', { from: admin, on: adminMsg, chatId: ADMIN_CHAT });
    assert.equal((await h.store.getOrder('ORD-261115-A2B3'))?.status, 'confirmed');
    assert.match(String(h.api.last('answerCallbackQuery')!.text), /Order ORD-261115-A2B3: Confirmed/);
    const edited = h.api.last('editMessageText')!;
    assert.match(String(edited.text), /CONFIRMED/);
    assert.match(String(edited.text), /Last update by Admin &lt;Ops&gt;/);
    assert.deepEqual(h.buttons(edited.reply_markup), ['o:ORD-261115-A2B3:ship', 'o:ORD-261115-A2B3:cancel']);
    const toCustomer = h.api.of('sendMessage').find((m) => m.chat_id === 42)!;
    assert.match(String(toCustomer.text), /has been confirmed/);

    await h.press('o:ORD-261115-A2B3:ship', { from: admin, on: adminMsg, chatId: ADMIN_CHAT });
    assert.match(h.api.of('sendMessage').filter((m) => m.chat_id === 42).at(-1)!.text as string, /shipped.*৳1,920/s);
    await h.press('o:ORD-261115-A2B3:deliver', { from: admin, on: adminMsg, chatId: ADMIN_CHAT });
    const order = (await h.store.getOrder('ORD-261115-A2B3'))!;
    assert.equal(order.status, 'delivered');
    assert.deepEqual(order.history.map((x) => x.status), ['pending', 'confirmed', 'shipped', 'delivered']);
    assert.equal(order.history[1]!.by, ADMIN_USER);
    assert.equal(h.buttons(h.api.last('editMessageText')!.reply_markup).length, 0, 'no actions after delivery');
    assert.deepEqual(
      h.sink.events.map((e) => e.type),
      ['order.created', 'order.status_changed', 'order.status_changed', 'order.status_changed'],
    );
  });

  test('invalid transitions are refused', async () => {
    const { h, adminMsg, admin } = await placed();
    await h.press('o:ORD-261115-A2B3:deliver', { from: admin, on: adminMsg, chatId: ADMIN_CHAT });
    assert.match(String(h.api.last('answerCallbackQuery')!.text), /already pending/);
    await h.press('o:ORD-261115-A2B3:cancel', { from: admin, on: adminMsg, chatId: ADMIN_CHAT });
    await h.press('o:ORD-261115-A2B3:confirm', { from: admin, on: adminMsg, chatId: ADMIN_CHAT });
    assert.match(String(h.api.last('answerCallbackQuery')!.text), /already cancelled/);
    assert.equal((await h.store.getOrder('ORD-261115-A2B3'))?.status, 'cancelled');
  });

  test('order actions outside the admin chat are refused', async () => {
    const { h } = await placed();
    await h.press('o:ORD-261115-A2B3:confirm'); // from the customer's private chat
    const ans = h.api.last('answerCallbackQuery')!;
    assert.equal(ans.show_alert, true);
    assert.match(String(ans.text), /Only shop admins/);
    assert.equal((await h.store.getOrder('ORD-261115-A2B3'))?.status, 'pending');
  });

  test('ADMIN_USER_IDS restricts who can press the buttons inside the group', async () => {
    const h = createHarness({ config: { adminUserIds: [ADMIN_USER] } });
    await h.checkoutCod();
    await h.press('ok');
    const other = h.user(555);
    await h.press('o:ORD-261115-A2B3:confirm', { from: other, chatId: ADMIN_CHAT });
    assert.match(String(h.api.last('answerCallbackQuery')!.text), /Only shop admins/);
    await h.press('o:ORD-261115-A2B3:confirm', { from: h.user(ADMIN_USER), chatId: ADMIN_CHAT });
    assert.equal((await h.store.getOrder('ORD-261115-A2B3'))?.status, 'confirmed');
  });

  test('unknown order ids and malformed data', async () => {
    const { h, admin } = await placed();
    await h.press('o:ORD-261115-ZZZZ:confirm', { from: admin, chatId: ADMIN_CHAT });
    assert.match(String(h.api.last('answerCallbackQuery')!.text), /Order not found/);
    await h.press('o:../../etc:confirm', { from: admin, chatId: ADMIN_CHAT });
    assert.match(String(h.api.last('answerCallbackQuery')!.text), /Order not found/);
    await h.press('o:ORD-261115-A2B3:explode', { from: admin, chatId: ADMIN_CHAT });
    assert.match(String(h.api.last('answerCallbackQuery')!.text), /Order not found/);
  });

  test('customer notification in Bangla for a Bangla order; blocked customer does not break the update', async () => {
    const h = createHarness();
    await h.press('l:bn');
    await h.checkoutCod();
    await h.press('ok');
    const admin = h.user(ADMIN_USER);
    await h.press('o:ORD-261115-A2B3:confirm', { from: admin, chatId: ADMIN_CHAT });
    assert.match(String(h.api.of('sendMessage').filter((m) => m.chat_id === 42).at(-1)!.text), /নিশ্চিত হয়েছে/);
    const original = h.api.sendMessage.bind(h.api);
    h.api.sendMessage = async (p) => {
      if (p.chat_id === 42) throw new Error('Forbidden: bot was blocked by the user');
      return original(p);
    };
    await h.press('o:ORD-261115-A2B3:ship', { from: admin, chatId: ADMIN_CHAT });
    assert.equal((await h.store.getOrder('ORD-261115-A2B3'))?.status, 'shipped');
  });

  test('/orders lists the customer orders with status', async () => {
    const { h, admin, adminMsg } = await placed();
    await h.press('o:ORD-261115-A2B3:confirm', { from: admin, on: adminMsg, chatId: ADMIN_CHAT });
    await h.text('/orders');
    assert.match(h.lastText(), /ORD-261115-A2B3 · 2026-11-15 · ৳1,920 · Confirmed/);
  });
});
