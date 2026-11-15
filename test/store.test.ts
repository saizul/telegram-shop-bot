import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../src/store/json.js';
import { hasNodeSqlite, openSqliteStore } from '../src/store/sqlite.js';
import { DuplicateOrderError, type Store } from '../src/store/types.js';
import type { Order, Session } from '../src/shop/types.js';
import { createHarness } from './helpers/harness.js';

const dir = mkdtempSync(join(tmpdir(), 'shop-bot-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const SQLITE = await hasNodeSqlite();

function order(id: string, userId: number, createdAt: string): Order {
  return {
    id,
    userId,
    chatId: userId,
    lang: 'en',
    status: 'pending',
    lines: [{ productId: 'p', name: 'P', unitPrice: 10, qty: 1, total: 10 }],
    subtotal: 10,
    deliveryFee: 70,
    total: 80,
    zone: 'inside',
    customer: { name: 'A', phone: '01712345678', districtId: 'dhaka', district: 'Dhaka', address: 'Somewhere 123' },
    payment: { method: 'cod' },
    createdAt,
    updatedAt: createdAt,
    history: [{ status: 'pending', at: createdAt }],
  };
}

function contract(name: string, make: () => Promise<Store>, skip: boolean | string = false) {
  describe(`${name} store contract`, { skip }, () => {
    test('sessions round-trip and are copies', async () => {
      const store = await make();
      assert.equal(await store.getSession(1), undefined);
      const s: Session = { userId: 1, chatId: 1, lang: 'bn', updatedAt: 5, checkout: { step: 'name', startedAt: 1 } };
      await store.saveSession(s);
      const got = await store.getSession(1);
      assert.deepEqual(got, s);
      got!.lang = 'en';
      assert.equal((await store.getSession(1))!.lang, 'bn');
      await store.saveSession({ ...s, lang: 'en' });
      assert.equal((await store.getSession(1))!.lang, 'en');
      await store.close();
    });

    test('carts keep order and can be cleared', async () => {
      const store = await make();
      assert.deepEqual(await store.getCart(1), []);
      await store.setCart(1, [{ productId: 'b', qty: 2 }, { productId: 'a', qty: 1 }]);
      assert.deepEqual(await store.getCart(1), [{ productId: 'b', qty: 2 }, { productId: 'a', qty: 1 }]);
      await store.setCart(1, [{ productId: 'a', qty: 3 }]);
      assert.deepEqual(await store.getCart(1), [{ productId: 'a', qty: 3 }]);
      await store.setCart(1, []);
      assert.deepEqual(await store.getCart(1), []);
      await store.close();
    });

    test('orders: create, duplicate, update, list newest first', async () => {
      const store = await make();
      await store.createOrder(order('ORD-1', 1, '2026-11-01T00:00:00Z'));
      await store.createOrder(order('ORD-2', 1, '2026-11-03T00:00:00Z'));
      await store.createOrder(order('ORD-3', 2, '2026-11-02T00:00:00Z'));
      await assert.rejects(store.createOrder(order('ORD-1', 1, '2026-11-04T00:00:00Z')), DuplicateOrderError);
      const o = (await store.getOrder('ORD-1'))!;
      o.status = 'confirmed';
      await store.saveOrder(o);
      assert.equal((await store.getOrder('ORD-1'))!.status, 'confirmed');
      assert.deepEqual((await store.listOrders(1, 10)).map((x) => x.id), ['ORD-2', 'ORD-1']);
      assert.deepEqual((await store.listOrders(1, 1)).map((x) => x.id), ['ORD-2']);
      assert.equal(await store.getOrder('missing'), undefined);
      await store.close();
    });
  });
}

contract('in-memory JSON', async () => new JsonStore());
contract('SQLite :memory:', () => openSqliteStore(':memory:'), SQLITE ? false : 'node:sqlite is not available in this Node.js version');

describe('JSON file store', () => {
  test('persists to disk atomically with private permissions and reloads', async () => {
    const path = join(dir, 'nested', 'shop.json');
    const a = new JsonStore(path);
    await a.setCart(7, [{ productId: 'x', qty: 1 }]);
    await a.createOrder(order('ORD-9', 7, '2026-11-01T00:00:00Z'));
    const b = new JsonStore(path);
    assert.deepEqual(await b.getCart(7), [{ productId: 'x', qty: 1 }]);
    assert.equal((await b.getOrder('ORD-9'))?.total, 80);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, 1);
    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
  });
});

describe('SQLite file store', { skip: SQLITE ? false : 'node:sqlite is not available in this Node.js version' }, () => {
  test('persists across reopen and runs a full bot checkout', async () => {
    const path = join(dir, 'db', 'shop.db');
    const store = await openSqliteStore(path);
    const h = createHarness({ store });
    await h.checkoutCod();
    await h.press('ok');
    await store.close();
    const reopened = await openSqliteStore(path);
    const o = await reopened.getOrder('ORD-261115-A2B3');
    assert.equal(o?.total, 1920);
    assert.equal((await reopened.getSession(42))?.profile?.phone, '01712345678');
    assert.deepEqual(await reopened.getCart(42), []);
    await reopened.close();
  });
});
