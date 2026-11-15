import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { ServiceAccountAuth, createJwtAssertion, parseServiceAccount } from '../src/google/auth.js';
import { GoogleSheetsClient } from '../src/google/sheets.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const KEY = { client_email: 'shop-bot@example-project.iam.gserviceaccount.com', private_key: PEM };

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

describe('service account auth', () => {
  test('parseServiceAccount fixes escaped newlines and validates fields', () => {
    const key = parseServiceAccount(JSON.stringify({ ...KEY, private_key: PEM.replace(/\n/g, '\\n') }));
    assert.equal(key.private_key, PEM);
    assert.throws(() => parseServiceAccount('{'), /not valid JSON/);
    assert.throws(() => parseServiceAccount('{"client_email":"x"}'), /client_email and private_key/);
  });

  test('JWT assertion is RS256-signed with the right claims', () => {
    const jwt = createJwtAssertion(KEY, 'https://www.googleapis.com/auth/spreadsheets', 1_700_000_000);
    const [h, c, s] = jwt.split('.') as [string, string, string];
    assert.deepEqual(decode(h), { alg: 'RS256', typ: 'JWT' });
    assert.deepEqual(decode(c), {
      iss: KEY.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url'));
    assert.equal(ok, true);
  });

  test('exchanges the JWT for a token and caches it until near expiry', async () => {
    let now = 1_700_000_000_000;
    const requests: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      requests.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ access_token: `tok${requests.length}`, expires_in: 3600, token_type: 'Bearer' }), { status: 200 });
    }) as typeof fetch;
    const auth = new ServiceAccountAuth({ key: KEY, fetch: fetchImpl, now: () => now });
    const [a, b] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
    assert.equal(a, 'tok1');
    assert.equal(b, 'tok1');
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.url, 'https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(requests[0]!.body);
    assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    assert.equal(form.get('assertion')!.split('.').length, 3);
    now += 3000 * 1000;
    assert.equal(await auth.getAccessToken(), 'tok1');
    now += 600 * 1000; // within 60 s of expiry
    assert.equal(await auth.getAccessToken(), 'tok2');
  });

  test('token errors are reported', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), { status: 400 })) as unknown as typeof fetch;
    await assert.rejects(new ServiceAccountAuth({ key: KEY, fetch: fetchImpl }).getAccessToken(), /400.*Invalid JWT Signature/);
  });
});

describe('Sheets values client', () => {
  const token = { getAccessToken: async () => 'test-access-token' };

  test('getValues encodes the range and sends the bearer token', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string> };
      return new Response(JSON.stringify({ range: 'Products!A1:L3', majorDimension: 'ROWS', values: [['id'], ['a']] }));
    }) as typeof fetch;
    const rows = await new GoogleSheetsClient(token, fetchImpl).getValues('abc123', "'My Products'!A1:L");
    assert.deepEqual(rows, [['id'], ['a']]);
    assert.equal(seen!.url, 'https://sheets.googleapis.com/v4/spreadsheets/abc123/values/\'My%20Products\'!A1%3AL?valueRenderOption=UNFORMATTED_VALUE');
    assert.equal(seen!.headers.authorization, 'Bearer test-access-token');
  });

  test('empty ranges return no rows', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ range: 'A1', majorDimension: 'ROWS' }))) as unknown as typeof fetch;
    assert.deepEqual(await new GoogleSheetsClient(token, fetchImpl).getValues('id', 'A1'), []);
  });

  test('appendValues uses RAW input and INSERT_ROWS', async () => {
    let seen: { url: string; method?: string; body: string } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, method: init.method, body: String(init.body) };
      return new Response(JSON.stringify({ updates: { updatedRows: 1 } }));
    }) as typeof fetch;
    await new GoogleSheetsClient(token, fetchImpl).appendValues('abc', 'Orders!A1', [['ORD-1', '=HYPERLINK("x")']]);
    assert.equal(seen!.method, 'POST');
    assert.equal(seen!.url, 'https://sheets.googleapis.com/v4/spreadsheets/abc/values/Orders!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS');
    assert.deepEqual(JSON.parse(seen!.body), { values: [['ORD-1', '=HYPERLINK("x")']] });
  });

  test('API errors carry the Google message', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { code: 403, message: 'The caller does not have permission' } }), { status: 403 })) as unknown as typeof fetch;
    await assert.rejects(new GoogleSheetsClient(token, fetchImpl).getValues('a', 'B'), /403: The caller does not have permission/);
  });
});
