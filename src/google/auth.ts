import { createSign } from 'node:crypto';

/** The fields of a Google service account key file that we need. */
export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
export const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

export function parseServiceAccount(json: string): ServiceAccountKey {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Google service account JSON is not valid JSON');
  }
  const key = data as Partial<ServiceAccountKey>;
  if (typeof key.client_email !== 'string' || typeof key.private_key !== 'string') {
    throw new Error('Google service account JSON needs client_email and private_key');
  }
  // Keys pasted into env vars often have literal "\n" sequences.
  return { ...key, private_key: key.private_key.replace(/\\n/g, '\n') } as ServiceAccountKey;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** Create a signed RS256 JWT assertion for the OAuth 2.0 JWT bearer flow. */
export function createJwtAssertion(key: ServiceAccountKey, scope: string, nowSeconds: number, lifetimeSeconds = 3600): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: key.client_email,
    scope,
    aud: key.token_uri ?? DEFAULT_TOKEN_URI,
    iat: nowSeconds,
    exp: nowSeconds + lifetimeSeconds,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key);
  return `${unsigned}.${base64url(signature)}`;
}

export interface TokenProvider {
  getAccessToken(): Promise<string>;
}

export interface ServiceAccountAuthOptions {
  key: ServiceAccountKey;
  scope?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Exchanges a service account JWT for an access token and caches it until shortly before expiry. */
export class ServiceAccountAuth implements TokenProvider {
  private token: { value: string; expiresAt: number } | undefined;
  private pending: Promise<string> | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: ServiceAccountAuthOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async getAccessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt - 60_000) return this.token.value;
    this.pending ??= this.fetchToken().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async fetchToken(): Promise<string> {
    const { key } = this.options;
    const assertion = createJwtAssertion(key, this.options.scope ?? SHEETS_SCOPE, Math.floor(this.now() / 1000));
    const res = await this.fetchImpl(key.token_uri ?? DEFAULT_TOKEN_URI, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      throw new Error(`Google token request failed (${res.status}): ${body.error_description ?? body.error ?? 'no access_token'}`);
    }
    this.token = { value: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }
}
