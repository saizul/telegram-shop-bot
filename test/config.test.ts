import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from '../src/config.js';

// A syntactically valid placeholder, not a real bot token.
const TOKEN = '123456789:' + 'A'.repeat(35);
const BASE = { TELEGRAM_BOT_TOKEN: TOKEN, ADMIN_CHAT_ID: '-1001234567890' };

describe('loadConfig', () => {
  test('defaults', () => {
    const c = loadConfig(BASE);
    assert.equal(c.mode, 'polling');
    assert.equal(c.defaultLang, 'bn');
    assert.equal(c.adminChatId, -1001234567890);
    assert.deepEqual(c.adminUserIds, []);
    assert.deepEqual(c.catalog, { source: 'json', file: './data/catalog.json', ttlMs: 300_000 });
    assert.deepEqual(c.storage, { kind: 'sqlite', path: './data/shop.db' });
    assert.deepEqual(c.delivery, { insideFee: 70, outsideFee: 130, insideDistricts: ['dhaka'] });
    assert.equal(c.webhook, undefined);
    assert.equal(c.n8n, undefined);
    assert.equal(c.bkashNumber, undefined);
  });

  test('required values', () => {
    assert.throws(() => loadConfig({}), /TELEGRAM_BOT_TOKEN is required/);
    assert.throws(() => loadConfig({ TELEGRAM_BOT_TOKEN: TOKEN }), /ADMIN_CHAT_ID is required/);
    assert.throws(() => loadConfig({ ...BASE, ADMIN_CHAT_ID: '@mygroup' }), /numeric chat id/);
  });

  test('webhook mode validates URL and secret token', () => {
    const env = { ...BASE, BOT_MODE: 'webhook', WEBHOOK_URL: 'https://shop.example.com/', WEBHOOK_SECRET: 'test_webhook_secret_value' };
    const c = loadConfig(env);
    assert.deepEqual(c.webhook, { publicUrl: 'https://shop.example.com', path: '/telegram/webhook', secretToken: 'test_webhook_secret_value', port: 8080, host: '0.0.0.0' });
    assert.throws(() => loadConfig({ ...env, WEBHOOK_URL: 'http://shop.example.com' }), /https/);
    assert.throws(() => loadConfig({ ...env, WEBHOOK_SECRET: 'short' }), /16-256/);
    assert.throws(() => loadConfig({ ...env, WEBHOOK_SECRET: 'has spaces in it ok?' }), /16-256/);
    assert.throws(() => loadConfig({ ...env, WEBHOOK_PATH: 'hook' }), /start with \//);
    assert.throws(() => loadConfig({ ...env, PORT: 'eighty' }), /PORT must be an integer/);
    assert.throws(() => loadConfig({ ...BASE, BOT_MODE: 'push' }), /BOT_MODE/);
  });

  test('Google Sheets catalogue and order export need credentials', () => {
    const env = { ...BASE, CATALOG_SOURCE: 'sheets', GOOGLE_SHEETS_ID: 'sheet-id' };
    assert.throws(() => loadConfig(env), /GOOGLE_SERVICE_ACCOUNT_FILE or GOOGLE_SERVICE_ACCOUNT_JSON/);
    const c = loadConfig({ ...env, GOOGLE_SERVICE_ACCOUNT_FILE: '/run/secrets/sa.json', SHEETS_EXPORT_ORDERS: 'true' }, (p) => `{"from":"${p}"}`);
    assert.equal(c.google?.serviceAccountJson, '{"from":"/run/secrets/sa.json"}');
    assert.deepEqual(c.catalog, { source: 'sheets', spreadsheetId: 'sheet-id', productsRange: 'Products!A1:L', categoriesRange: 'Categories!A1:D', ttlMs: 300_000 });
    assert.deepEqual(c.ordersSheet, { spreadsheetId: 'sheet-id', range: 'Orders!A1', logStatusChanges: true });
    const none = loadConfig({ ...env, GOOGLE_SERVICE_ACCOUNT_JSON: '{}', SHEETS_CATEGORIES_RANGE: 'none' });
    assert.equal(none.catalog.source === 'sheets' && none.catalog.categoriesRange, null);
    assert.throws(() => loadConfig({ ...BASE, CATALOG_SOURCE: 'csv' }), /CATALOG_SOURCE/);
  });

  test('delivery, bKash, admins, storage, n8n and limits', () => {
    const c = loadConfig({
      ...BASE,
      DELIVERY_FEE_INSIDE_DHAKA: '60',
      DELIVERY_FEE_OUTSIDE_DHAKA: '120',
      INSIDE_DHAKA_DISTRICTS: 'dhaka, gazipur, narayanganj',
      FREE_DELIVERY_MIN: '3000',
      BKASH_NUMBER: '+880 1711-000000',
      ADMIN_USER_IDS: '111, 222',
      STORAGE: 'json',
      DATA_DIR: '/var/lib/shop/',
      N8N_WEBHOOK_URL: 'https://n8n.example.com/webhook/orders',
      N8N_WEBHOOK_SECRET: 'from-env',
      RATE_LIMIT_BURST: '5',
      SPAM_MUTE_MINUTES: '30',
      DEFAULT_LANG: 'en',
      LOG_LEVEL: 'debug',
    });
    assert.deepEqual(c.delivery, { insideFee: 60, outsideFee: 120, insideDistricts: ['dhaka', 'gazipur', 'narayanganj'], freeAbove: 3000 });
    assert.equal(c.bkashNumber, '01711000000');
    assert.deepEqual(c.adminUserIds, [111, 222]);
    assert.deepEqual(c.storage, { kind: 'json', path: '/var/lib/shop/shop.json' });
    assert.deepEqual(c.n8n, { url: 'https://n8n.example.com/webhook/orders', secret: 'from-env' });
    assert.equal(c.rateLimit.capacity, 5);
    assert.equal(c.rateLimit.muteMs, 30 * 60_000);
    assert.equal(c.logLevel, 'debug');
  });

  test('invalid values are reported by name', () => {
    const bad: Array<[Record<string, string>, RegExp]> = [
      [{ DELIVERY_FEE_INSIDE_DHAKA: '-1' }, /DELIVERY_FEE_INSIDE_DHAKA/],
      [{ INSIDE_DHAKA_DISTRICTS: 'atlantis' }, /unknown district "atlantis"/],
      [{ BKASH_NUMBER: '12345' }, /BKASH_NUMBER/],
      [{ ADMIN_USER_IDS: 'abc' }, /ADMIN_USER_IDS/],
      [{ STORAGE: 'mongo' }, /STORAGE/],
      [{ DEFAULT_LANG: 'fr' }, /DEFAULT_LANG/],
      [{ LOG_LEVEL: 'loud' }, /LOG_LEVEL/],
      [{ SHEETS_EXPORT_ORDERS: 'maybe' }, /true or false/],
      [{ RATE_LIMIT_BURST: '2.5' }, /RATE_LIMIT_BURST/],
    ];
    for (const [env, re] of bad) assert.throws(() => loadConfig({ ...BASE, ...env }), (e: unknown) => e instanceof ConfigError && re.test((e as Error).message));
  });
});
