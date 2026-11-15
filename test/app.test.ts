import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/logger.js';
import { FakeTelegramApi } from './helpers/fake-api.js';

const dir = mkdtempSync(join(tmpdir(), 'shop-bot-app-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const TOKEN = '123456789:' + 'C'.repeat(35);
const CATALOG_FILE = new URL('../../examples/catalog.json', import.meta.url).pathname;

describe('createApp wiring', () => {
  test('polling mode: registers commands in both languages, serves updates, stops cleanly', async () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: TOKEN,
      ADMIN_CHAT_ID: '-100555',
      CATALOG_FILE,
      STORAGE: 'json',
      DATA_DIR: dir,
      DEFAULT_LANG: 'en',
    });
    const api = new FakeTelegramApi();
    api.updates = [[{ update_id: 1, message: { message_id: 1, date: 0, chat: { id: 42, type: 'private' }, from: { id: 42, is_bot: false, first_name: 'R' }, text: '/start' } }]];
    const app = await createApp(config, { api, logger: silentLogger });
    await app.start();
    await new Promise((r) => setTimeout(r, 30));
    await app.stop();
    const commands = api.of('setMyCommands');
    assert.equal(commands.length, 2);
    assert.equal(commands[1]!.language_code, 'bn');
    assert.equal(api.of('deleteWebhook').length, 1);
    assert.ok(api.of('sendMessage').some((m) => String(m.text).includes('Welcome')));
  });

  test('webhook mode: starts the HTTP server and calls setWebhook with the secret token', async () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: TOKEN,
      ADMIN_CHAT_ID: '-100555',
      CATALOG_FILE,
      STORAGE: 'json',
      DATA_DIR: dir,
      BOT_MODE: 'webhook',
      WEBHOOK_URL: 'https://shop.example.com',
      WEBHOOK_SECRET: 'local_test_secret_0123',
      PORT: '18093',
      HOST: '127.0.0.1',
    });
    const api = new FakeTelegramApi();
    const app = await createApp(config, { api, logger: silentLogger });
    await app.start();
    try {
      assert.deepEqual(api.last('setWebhook'), {
        url: 'https://shop.example.com/telegram/webhook',
        secret_token: 'local_test_secret_0123',
        allowed_updates: ['message', 'callback_query'],
        max_connections: 40,
      });
      const res = await fetch('http://127.0.0.1:18093/telegram/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'local_test_secret_0123' },
        body: JSON.stringify({ update_id: 77, message: { message_id: 1, date: 0, chat: { id: 9, type: 'private' }, from: { id: 9, is_bot: false, first_name: 'K' }, text: '/help' } }),
      });
      assert.equal(res.status, 200);
      await new Promise((r) => setTimeout(r, 30));
      assert.ok(api.of('sendMessage').some((m) => m.chat_id === 9));
    } finally {
      await app.stop();
    }
  });

  test('start fails fast on a broken catalogue', async () => {
    const config = loadConfig({ TELEGRAM_BOT_TOKEN: TOKEN, ADMIN_CHAT_ID: '-1', CATALOG_FILE: join(dir, 'missing.json'), STORAGE: 'json', DATA_DIR: dir });
    const app = await createApp(config, { api: new FakeTelegramApi(), logger: silentLogger });
    await assert.rejects(app.start(), /Cannot read catalogue/);
    await app.stop();
  });
});
