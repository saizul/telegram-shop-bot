import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { HttpTelegramApi, TelegramApiError } from '../src/telegram/api.js';
import { startWebhookServer, verifySecretToken } from '../src/server/webhook.js';
import { runPolling } from '../src/server/polling.js';
import { silentLogger } from '../src/logger.js';
import type { Update } from '../src/telegram/types.js';
import { FakeTelegramApi } from './helpers/fake-api.js';

// Placeholder in the documented token format, not a real token.
const TOKEN = '123456789:' + 'B'.repeat(35);

describe('HttpTelegramApi', () => {
  test('rejects malformed tokens', () => {
    assert.throws(() => new HttpTelegramApi({ token: 'nope' }), /does not look like a bot token/);
  });

  test('POSTs JSON to /bot<token>/<method> and returns result', async () => {
    let seen: { url: string; body: unknown; method?: string } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(String(init.body)), method: init.method };
      return new Response(JSON.stringify({ ok: true, result: { message_id: 5, date: 0, chat: { id: 1, type: 'private' } } }));
    }) as typeof fetch;
    const api = new HttpTelegramApi({ token: TOKEN, fetch: fetchImpl, baseUrl: 'https://api.example.test/' });
    const msg = await api.sendPhoto({ chat_id: 1, photo: 'https://example.com/a.jpg', caption: 'hi', reply_markup: { inline_keyboard: [[{ text: 'a', callback_data: 'b' }]] } });
    assert.equal(msg.message_id, 5);
    assert.equal(seen!.url, `https://api.example.test/bot${TOKEN}/sendPhoto`);
    assert.equal(seen!.method, 'POST');
    assert.deepEqual(seen!.body, { chat_id: 1, photo: 'https://example.com/a.jpg', caption: 'hi', reply_markup: { inline_keyboard: [[{ text: 'a', callback_data: 'b' }]] } });
  });

  test('ok:false becomes TelegramApiError; "not modified" is recognised', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: message is not modified' }), { status: 400 })) as unknown as typeof fetch;
    const api = new HttpTelegramApi({ token: TOKEN, fetch: fetchImpl });
    await assert.rejects(api.editMessageText({ chat_id: 1, message_id: 2, text: 'x' }), (e: unknown) => e instanceof TelegramApiError && e.isNotModified && e.errorCode === 400);
  });

  test('429 with a short retry_after is retried once', async () => {
    const responses = [
      { ok: false, error_code: 429, description: 'Too Many Requests: retry after 1', parameters: { retry_after: 1 } },
      { ok: true, result: true },
    ];
    const sleeps: number[] = [];
    const fetchImpl = (async () => new Response(JSON.stringify(responses.shift()))) as unknown as typeof fetch;
    const api = new HttpTelegramApi({ token: TOKEN, fetch: fetchImpl, sleep: async (ms) => void sleeps.push(ms) });
    assert.equal(await api.answerCallbackQuery({ callback_query_id: 'q' }), true);
    assert.deepEqual(sleeps, [1000]);
    const longWait = (async () => new Response(JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 60 } }))) as unknown as typeof fetch;
    await assert.rejects(new HttpTelegramApi({ token: TOKEN, fetch: longWait }).getMe(), (e: unknown) => e instanceof TelegramApiError && e.retryAfter === 60);
  });

  test('non-JSON responses are reported', async () => {
    const fetchImpl = (async () => new Response('<html>Bad Gateway</html>', { status: 502 })) as unknown as typeof fetch;
    await assert.rejects(new HttpTelegramApi({ token: TOKEN, fetch: fetchImpl }).getMe(), /invalid JSON response \(HTTP 502\)/);
  });

  test('setWebhook sends secret_token and allowed_updates', async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: true, result: true }));
    }) as typeof fetch;
    await new HttpTelegramApi({ token: TOKEN, fetch: fetchImpl }).setWebhook({ url: 'https://shop.example.com/telegram/webhook', secret_token: 'abc_DEF-123', allowed_updates: ['message', 'callback_query'] });
    assert.deepEqual(body, { url: 'https://shop.example.com/telegram/webhook', secret_token: 'abc_DEF-123', allowed_updates: ['message', 'callback_query'] });
  });
});

describe('webhook server', () => {
  const SECRET = 'test_secret_token-0123456789';

  async function withServer(fn: (base: string, received: Update[]) => Promise<void>) {
    const received: Update[] = [];
    const server = await startWebhookServer({
      port: 0,
      host: '127.0.0.1',
      path: '/telegram/webhook',
      secretToken: SECRET,
      logger: silentLogger,
      maxBodyBytes: 2048,
      handle: async (u) => void received.push(u),
    });
    const { port } = server.address() as AddressInfo;
    try {
      await fn(`http://127.0.0.1:${port}`, received);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  const post = (url: string, body: string, headers: Record<string, string> = {}) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

  test('accepts updates with the right secret token header', async () => {
    await withServer(async (base, received) => {
      const res = await post(`${base}/telegram/webhook`, JSON.stringify({ update_id: 10 }), { 'X-Telegram-Bot-Api-Secret-Token': SECRET });
      assert.equal(res.status, 200);
      await new Promise((r) => setTimeout(r, 10));
      assert.deepEqual(received, [{ update_id: 10 }]);
    });
  });

  test('rejects missing or wrong secret, wrong path/method/type, bad JSON and big bodies', async () => {
    await withServer(async (base, received) => {
      const url = `${base}/telegram/webhook`;
      const auth = { 'X-Telegram-Bot-Api-Secret-Token': SECRET };
      assert.equal((await post(url, '{"update_id":1}')).status, 401);
      assert.equal((await post(url, '{"update_id":1}', { 'X-Telegram-Bot-Api-Secret-Token': SECRET + 'x' })).status, 401);
      assert.equal((await post(`${base}/other`, '{"update_id":1}', auth)).status, 404);
      assert.equal((await fetch(url)).status, 405);
      assert.equal((await post(url, '{"update_id":1}', { ...auth, 'content-type': 'text/plain' })).status, 415);
      assert.equal((await post(url, '{nope', auth)).status, 400);
      assert.equal((await post(url, '{"hello":1}', auth)).status, 400);
      const big = await post(url, JSON.stringify({ update_id: 1, pad: 'x'.repeat(5000) }), auth).catch(() => ({ status: 413 }));
      assert.equal(big.status, 413);
      assert.equal(received.length, 0);
      assert.equal((await fetch(`${base}/healthz`)).status, 200);
    });
  });

  test('verifySecretToken', () => {
    assert.equal(verifySecretToken('abc', 'abc'), true);
    assert.equal(verifySecretToken('abd', 'abc'), false);
    assert.equal(verifySecretToken('ab', 'abc'), false);
    assert.equal(verifySecretToken(undefined, 'abc'), false);
    assert.equal(verifySecretToken(['abc'], 'abc'), false);
  });
});

describe('long polling', () => {
  test('deletes the webhook, advances the offset and handles every update', async () => {
    const api = new FakeTelegramApi();
    api.updates = [[{ update_id: 5 }, { update_id: 6 }], [], [{ update_id: 9 }]];
    const handled: number[] = [];
    await runPolling({ api, handle: async (u) => void handled.push(u.update_id), logger: silentLogger, timeout: 1, maxIterations: 3 });
    assert.deepEqual(handled, [5, 6, 9]);
    assert.deepEqual(api.of('deleteWebhook'), [{ drop_pending_updates: false }]);
    const offsets = api.of('getUpdates').map((p) => p.offset);
    assert.deepEqual(offsets, [undefined, 7, 7]);
    assert.deepEqual(api.of('getUpdates')[0]!.allowed_updates, ['message', 'callback_query']);
  });

  test('backs off on errors, honouring retry_after', async () => {
    const api = new FakeTelegramApi();
    api.failNext('getUpdates', new TelegramApiError('getUpdates', 429, 'Too Many Requests', 7));
    const sleeps: number[] = [];
    await runPolling({ api, handle: async () => {}, logger: silentLogger, maxIterations: 2, sleep: async (ms) => void sleeps.push(ms) });
    assert.deepEqual(sleeps, [7000]);
  });

  test('stops when aborted', async () => {
    const api = new FakeTelegramApi();
    const ac = new AbortController();
    ac.abort();
    await runPolling({ api, handle: async () => {}, logger: silentLogger, signal: ac.signal });
    assert.equal(api.of('getUpdates').length, 0);
  });
});
