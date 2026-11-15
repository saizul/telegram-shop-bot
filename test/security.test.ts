import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/security/rate-limit.js';
import { KeyedQueue, RecentIds } from '../src/security/keyed-queue.js';
import { ADMIN_CHAT, createHarness } from './helpers/harness.js';

describe('RateLimiter', () => {
  test('token bucket allows a burst then refills', () => {
    let now = 0;
    const rl = new RateLimiter({ capacity: 3, refillPerSecond: 1, maxStrikes: 100 }, () => now);
    assert.equal(rl.check(1).allowed, true);
    assert.equal(rl.check(1).allowed, true);
    assert.equal(rl.check(1).allowed, true);
    const denied = rl.check(1);
    assert.equal(denied.allowed, false);
    assert.ok(!denied.allowed && denied.reason === 'rate' && denied.notify === true && denied.retryAfterMs > 0);
    const again = rl.check(1);
    assert.ok(!again.allowed && again.notify === false, 'notify only once in a row');
    assert.equal(rl.check(2).allowed, true, 'other users unaffected');
    now = 1000;
    assert.equal(rl.check(1).allowed, true);
  });

  test('persistent flooding leads to a mute', () => {
    let now = 0;
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 0.01, maxStrikes: 3, muteMs: 60_000 }, () => now);
    rl.check(1);
    rl.check(1);
    rl.check(1);
    const v = rl.check(1);
    assert.ok(!v.allowed && v.reason === 'muted');
    now = 30_000;
    assert.ok(!rl.check(1).allowed);
    now = 61_000;
    assert.equal(rl.check(1).allowed, true);
  });

  test('repeated identical messages are muted; long messages refused', () => {
    let now = 0;
    const rl = new RateLimiter({ capacity: 100, refillPerSecond: 100, maxRepeats: 3, maxTextLength: 10 }, () => now);
    assert.equal(rl.check(1, 'BUY NOW').allowed, true);
    assert.equal(rl.check(1, 'buy now').allowed, true);
    assert.equal(rl.check(1, 'buy now ').allowed, true);
    const v = rl.check(1, 'buy now');
    assert.ok(!v.allowed && v.reason === 'repeat');
    const long = rl.check(2, 'x'.repeat(11));
    assert.ok(!long.allowed && long.reason === 'too-long');
    assert.equal(rl.check(3, 'different').allowed, true);
  });

  test('sweep forgets idle users', () => {
    let now = 0;
    const rl = new RateLimiter({}, () => now);
    rl.check(1);
    rl.check(2);
    now = 2 * 3600_000;
    rl.check(2);
    assert.equal(rl.sweep(3600_000), 1);
    assert.equal(rl.size, 1);
  });
});

describe('KeyedQueue and RecentIds', () => {
  test('tasks for one key run in order; other keys run in parallel', async () => {
    const q = new KeyedQueue();
    const log: string[] = [];
    const slow = (key: string, label: string, ms: number) =>
      q.run(key, async () => {
        log.push(`start ${label}`);
        await new Promise((r) => setTimeout(r, ms));
        log.push(`end ${label}`);
      });
    await Promise.all([slow('a', 'a1', 20), slow('a', 'a2', 1), slow('b', 'b1', 1)]);
    assert.ok(log.indexOf('end a1') < log.indexOf('start a2'));
    assert.ok(log.indexOf('start b1') < log.indexOf('end a1'));
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(q.pending, 0);
  });

  test('a failing task does not block the next one', async () => {
    const q = new KeyedQueue();
    await assert.rejects(q.run(1, async () => Promise.reject(new Error('x'))));
    assert.equal(await q.run(1, async () => 'ok'), 'ok');
  });

  test('RecentIds drops duplicates and evicts old ids', () => {
    const r = new RecentIds(2);
    assert.equal(r.add(1), true);
    assert.equal(r.add(1), false);
    r.add(2);
    r.add(3);
    assert.equal(r.add(1), true, 'evicted');
  });
});

describe('rate limiting in the bot', () => {
  test('callback floods get a short notice; message floods are told once', async () => {
    const h = createHarness({ rateLimit: { capacity: 2, refillPerSecond: 0.001, maxStrikes: 100 } });
    // user 42 floods with buttons
    await h.press('c');
    await h.press('c');
    h.api.reset();
    await h.press('c');
    assert.match(String(h.api.last('answerCallbackQuery')!.text), /Too many requests/);
    assert.equal(h.api.of('editMessageText').length, 0);
    h.api.reset();
    const other = h.user(43);
    await h.text('hi', other);
    await h.text('hello', other);
    await h.text('hey', other);
    await h.text('anyone?', other);
    const sent = h.api.of('sendMessage').map((m) => String(m.text));
    assert.equal(sent.length, 3, 'two answered, then a single notice, then silence');
    assert.equal(sent.filter((t) => /Too many requests/.test(t)).length, 1);
  });

  test('admin group button presses are not rate limited', async () => {
    const h = createHarness({ rateLimit: { capacity: 1, refillPerSecond: 0.001 } });
    const at = '2026-11-15T06:00:00.000Z';
    await h.store.createOrder({
      id: 'ORD-261115-A2B3', userId: 42, chatId: 42, lang: 'en', status: 'pending',
      lines: [{ productId: 'tea-500', name: 'Tea', unitPrice: 350, qty: 1, total: 350 }],
      subtotal: 350, deliveryFee: 70, total: 420, zone: 'inside',
      customer: { name: 'Rahim', phone: '01712345678', districtId: 'dhaka', district: 'Dhaka', address: 'House 1, Road 2' },
      payment: { method: 'cod' }, createdAt: at, updatedAt: at, history: [{ status: 'pending', at }],
    });
    const admin = h.user(999);
    for (const action of ['confirm', 'ship', 'deliver']) {
      await h.press(`o:ORD-261115-A2B3:${action}`, { from: admin, chatId: ADMIN_CHAT });
    }
    assert.equal((await h.store.getOrder('ORD-261115-A2B3'))?.status, 'delivered');
  });
});
