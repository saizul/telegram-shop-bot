import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { OrderEvents, type OrderEvent } from '../src/integrations/events.js';
import { WebhookSink, signPayload } from '../src/integrations/n8n.js';
import { ORDER_COLUMNS, SheetsOrderSink, orderToRow } from '../src/integrations/sheets-export.js';
import type { Order } from '../src/shop/types.js';

const ORDER: Order = {
  id: 'ORD-261115-A2B3',
  userId: 42,
  chatId: 42,
  username: 'rahim',
  lang: 'bn',
  status: 'pending',
  lines: [{ productId: 'tea-500', name: 'Sylhet Tea / সিলেটের চা', unitPrice: 350, qty: 2, total: 700 }],
  subtotal: 700,
  deliveryFee: 70,
  total: 770,
  zone: 'inside',
  customer: { name: 'Rahim', phone: '01712345678', districtId: 'dhaka', district: 'Dhaka', address: 'House 1, Road 2, Dhanmondi' },
  payment: { method: 'bkash', bkashTrxId: '9C7D6E5F4G' },
  createdAt: '2026-11-15T06:00:00.000Z',
  updatedAt: '2026-11-15T06:00:00.000Z',
  history: [{ status: 'pending', at: '2026-11-15T06:00:00.000Z' }],
};
const CREATED: OrderEvent = { type: 'order.created', order: ORDER, at: ORDER.createdAt };

describe('n8n webhook sink', () => {
  test('posts a signed JSON payload', async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response('ok');
    }) as typeof fetch;
    const sink = new WebhookSink({ url: 'https://n8n.example.com/webhook/shop', secret: 'test-secret', fetch: fetchImpl, now: () => 1_763_186_400_000 });
    await sink.handle(CREATED);
    assert.equal(seen.length, 1);
    const { headers, body } = seen[0]!;
    assert.equal(headers['x-shop-event'], 'order.created');
    assert.equal(headers['x-shop-timestamp'], '1763186400');
    const expected = 'sha256=' + createHmac('sha256', 'test-secret').update(`1763186400.${body}`).digest('hex');
    assert.equal(headers['x-shop-signature'], expected);
    const payload = JSON.parse(body);
    assert.equal(payload.event, 'order.created');
    assert.equal(payload.order.id, ORDER.id);
    assert.equal(payload.order.payment.bkashTrxId, '9C7D6E5F4G');
    assert.equal(payload.order.telegram.username, 'rahim');
  });

  test('no signature header without a secret', async () => {
    let headers: Record<string, string> = {};
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response('ok');
    }) as typeof fetch;
    await new WebhookSink({ url: 'http://n8n:5678/webhook/shop', fetch: fetchImpl }).handle(CREATED);
    assert.equal(headers['x-shop-signature'], undefined);
  });

  test('retries 5xx and network errors with backoff, then succeeds', async () => {
    const statuses = [503, 0, 200];
    const sleeps: number[] = [];
    const fetchImpl = (async () => {
      const s = statuses.shift()!;
      if (s === 0) throw new TypeError('fetch failed');
      return new Response('', { status: s });
    }) as unknown as typeof fetch;
    await new WebhookSink({ url: 'https://n8n.example.com/w', fetch: fetchImpl, sleep: async (ms) => void sleeps.push(ms) }).handle(CREATED);
    assert.deepEqual(sleeps, [500, 1000]);
  });

  test('gives up after the configured attempts; does not retry 4xx', async () => {
    let calls = 0;
    const always500 = (async () => {
      calls++;
      return new Response('', { status: 500 });
    }) as unknown as typeof fetch;
    await assert.rejects(new WebhookSink({ url: 'https://n.example.com/w', fetch: always500, attempts: 2, sleep: async () => {} }).handle(CREATED), /responded 500/);
    assert.equal(calls, 2);
    calls = 0;
    const always404 = (async () => {
      calls++;
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    await assert.rejects(new WebhookSink({ url: 'https://n.example.com/w', fetch: always404, sleep: async () => {} }).handle(CREATED), /responded 404/);
    assert.equal(calls, 1);
  });

  test('refuses insecure public URLs and embedded credentials', () => {
    assert.throws(() => new WebhookSink({ url: 'http://n8n.example.com/webhook' }), /https/);
    assert.throws(() => new WebhookSink({ url: 'ftp://n8n/webhook' }), /http\(s\)/);
    const withCreds = new URL('https://n8n.example.com/webhook');
    withCreds.username = 'someone';
    assert.throws(() => new WebhookSink({ url: withCreds.toString() }), /credentials/);
    assert.doesNotThrow(() => new WebhookSink({ url: 'http://localhost:5678/webhook' }));
  });

  test('signPayload is deterministic', () => {
    assert.equal(signPayload('k', '1', '{}'), 'sha256=' + createHmac('sha256', 'k').update('1.{}').digest('hex'));
  });
});

describe('Google Sheets order export', () => {
  test('row matches the column list', () => {
    const row = orderToRow(ORDER, 'order.created');
    assert.equal(row.length, ORDER_COLUMNS.length);
    assert.equal(row[0], ORDER.id);
    assert.equal(row[7], '2 x Sylhet Tea / সিলেটের চা (tea-500)');
    assert.equal(row[10], 770);
    assert.equal(row[12], '9C7D6E5F4G');
    assert.equal(row.at(-1), 'order.created');
  });

  test('appends rows; status changes optional', async () => {
    const appended: unknown[][][] = [];
    const sheets = { getValues: async () => [], appendValues: async (_id: string, _r: string, rows: unknown[][]) => void appended.push(rows) };
    const sink = new SheetsOrderSink(sheets, { spreadsheetId: 's' });
    await sink.handle(CREATED);
    await sink.handle({ type: 'order.status_changed', order: { ...ORDER, status: 'confirmed' }, previousStatus: 'pending', at: 'now' });
    assert.equal(appended.length, 2);
    const quiet = new SheetsOrderSink(sheets, { spreadsheetId: 's', logStatusChanges: false });
    await quiet.handle({ type: 'order.status_changed', order: ORDER, previousStatus: 'pending', at: 'now' });
    assert.equal(appended.length, 2);
  });
});

describe('OrderEvents fan-out', () => {
  test('a failing sink does not stop the others', async () => {
    const errors: string[] = [];
    const got: string[] = [];
    const events = new OrderEvents(
      [
        { name: 'bad', handle: async () => Promise.reject(new Error('boom')) },
        { name: 'good', handle: async (e) => void got.push(e.type) },
      ],
      { debug() {}, info() {}, warn() {}, error: (m, meta) => void errors.push(`${m}:${String(meta?.sink)}`) },
    );
    await events.emit(CREATED);
    assert.deepEqual(got, ['order.created']);
    assert.deepEqual(errors, ['order event sink failed:bad']);
  });
});
