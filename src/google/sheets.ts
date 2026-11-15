import type { TokenProvider } from './auth.js';

export interface SheetsClient {
  /** Read a range. Returns rows of cell values (empty trailing cells are omitted by Google). */
  getValues(spreadsheetId: string, range: string): Promise<unknown[][]>;
  /** Append rows after the last row of the table in `range`. */
  appendValues(spreadsheetId: string, range: string, rows: unknown[][]): Promise<void>;
}

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Minimal client for the Sheets API v4 `spreadsheets.values` endpoints. */
export class GoogleSheetsClient implements SheetsClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly auth: TokenProvider,
    fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  private async request(url: string, init: RequestInit = {}): Promise<unknown> {
    const token = await this.auth.getAccessToken();
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!res.ok) throw new Error(`Google Sheets ${res.status}: ${body.error?.message ?? res.statusText}`);
    return body;
  }

  async getValues(spreadsheetId: string, range: string): Promise<unknown[][]> {
    const url = `${BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
    const body = (await this.request(url)) as { values?: unknown[][] };
    return body.values ?? [];
  }

  async appendValues(spreadsheetId: string, range: string, rows: unknown[][]): Promise<void> {
    // RAW stores customer text as-is, so a name like "=HYPERLINK(...)" is never run as a formula.
    const url =
      `${BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append` +
      '?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
    await this.request(url, { method: 'POST', body: JSON.stringify({ values: rows }) });
  }
}
