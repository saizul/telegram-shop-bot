import { isLang, type Lang } from './i18n/strings.js';
import { getDistrict } from './bd/districts.js';
import { normaliseBdPhone } from './bd/phone.js';
import type { LogLevel } from './logger.js';
import type { DeliveryConfig } from './shop/delivery.js';
import { DEFAULT_RATE_LIMIT, type RateLimitConfig } from './security/rate-limit.js';

export interface AppConfig {
  botToken: string;
  shopName: string;
  defaultLang: Lang;
  /** Chat id of the admin group (negative number for groups). */
  adminChatId: number;
  /** If set, only these Telegram user ids may press order action buttons. */
  adminUserIds: number[];
  mode: 'polling' | 'webhook';
  webhook?: {
    publicUrl: string;
    path: string;
    secretToken: string;
    port: number;
    host: string;
  };
  catalog:
    | { source: 'json'; file: string; ttlMs: number }
    | { source: 'sheets'; spreadsheetId: string; productsRange: string; categoriesRange: string | null; ttlMs: number };
  google?: { serviceAccountJson: string };
  ordersSheet?: { spreadsheetId: string; range: string; logStatusChanges: boolean };
  storage: { kind: 'sqlite' | 'json'; path: string };
  n8n?: { url: string; secret?: string };
  delivery: DeliveryConfig;
  bkashNumber?: string;
  rateLimit: RateLimitConfig;
  logLevel: LogLevel;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

function req(env: Env, name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new ConfigError(`${name} is required`);
  return v;
}

function opt(env: Env, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

function num(env: Env, name: string, fallback: number, { min = -Infinity, int = false } = {}): number {
  const raw = opt(env, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || (int && !Number.isInteger(n))) throw new ConfigError(`${name} must be a${int ? 'n integer' : ' number'} >= ${min}, got "${raw}"`);
  return n;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
  const raw = opt(env, name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new ConfigError(`${name} must be true or false, got "${raw}"`);
}

const SECRET_TOKEN_RE = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * Read configuration from environment variables. See `.env.example` for the full list.
 * `readFile` is used for GOOGLE_SERVICE_ACCOUNT_FILE and is injectable for tests.
 */
export function loadConfig(env: Env, readFile: (path: string) => string = () => {
  throw new ConfigError('GOOGLE_SERVICE_ACCOUNT_FILE cannot be read in this context');
}): AppConfig {
  const botToken = req(env, 'TELEGRAM_BOT_TOKEN');
  const adminChatIdRaw = req(env, 'ADMIN_CHAT_ID');
  if (!/^-?\d+$/.test(adminChatIdRaw)) throw new ConfigError('ADMIN_CHAT_ID must be a numeric chat id (groups are negative)');
  const adminUserIds = (opt(env, 'ADMIN_USER_IDS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (!/^\d+$/.test(s)) throw new ConfigError(`ADMIN_USER_IDS contains an invalid id "${s}"`);
      return Number(s);
    });

  const defaultLang = opt(env, 'DEFAULT_LANG') ?? 'bn';
  if (!isLang(defaultLang)) throw new ConfigError('DEFAULT_LANG must be "bn" or "en"');

  const mode = opt(env, 'BOT_MODE') ?? 'polling';
  if (mode !== 'polling' && mode !== 'webhook') throw new ConfigError('BOT_MODE must be "polling" or "webhook"');

  let webhook: AppConfig['webhook'];
  if (mode === 'webhook') {
    const publicUrl = req(env, 'WEBHOOK_URL');
    if (!/^https:\/\//.test(publicUrl)) throw new ConfigError('WEBHOOK_URL must be an https URL');
    const secretToken = req(env, 'WEBHOOK_SECRET');
    if (!SECRET_TOKEN_RE.test(secretToken) || secretToken.length < 16) {
      throw new ConfigError('WEBHOOK_SECRET must be 16-256 characters of A-Z a-z 0-9 _ -');
    }
    const path = opt(env, 'WEBHOOK_PATH') ?? '/telegram/webhook';
    if (!path.startsWith('/')) throw new ConfigError('WEBHOOK_PATH must start with /');
    webhook = {
      publicUrl: publicUrl.replace(/\/+$/, ''),
      path,
      secretToken,
      port: num(env, 'PORT', 8080, { min: 1, int: true }),
      host: opt(env, 'HOST') ?? '0.0.0.0',
    };
  }

  const ttlMs = num(env, 'CATALOG_TTL_SECONDS', 300, { min: 0 }) * 1000;
  const catalogSource = opt(env, 'CATALOG_SOURCE') ?? 'json';
  let catalog: AppConfig['catalog'];
  if (catalogSource === 'json') {
    catalog = { source: 'json', file: opt(env, 'CATALOG_FILE') ?? './data/catalog.json', ttlMs };
  } else if (catalogSource === 'sheets') {
    catalog = {
      source: 'sheets',
      spreadsheetId: req(env, 'GOOGLE_SHEETS_ID'),
      productsRange: opt(env, 'SHEETS_PRODUCTS_RANGE') ?? 'Products!A1:L',
      categoriesRange: opt(env, 'SHEETS_CATEGORIES_RANGE') === 'none' ? null : (opt(env, 'SHEETS_CATEGORIES_RANGE') ?? 'Categories!A1:D'),
      ttlMs,
    };
  } else throw new ConfigError('CATALOG_SOURCE must be "json" or "sheets"');

  const exportOrders = bool(env, 'SHEETS_EXPORT_ORDERS', false);
  let google: AppConfig['google'];
  if (catalog.source === 'sheets' || exportOrders) {
    const inline = opt(env, 'GOOGLE_SERVICE_ACCOUNT_JSON');
    const file = opt(env, 'GOOGLE_SERVICE_ACCOUNT_FILE');
    if (!inline && !file) throw new ConfigError('Set GOOGLE_SERVICE_ACCOUNT_FILE or GOOGLE_SERVICE_ACCOUNT_JSON to use Google Sheets');
    google = { serviceAccountJson: inline ?? readFile(file!) };
  }
  const ordersSheet = exportOrders
    ? {
        spreadsheetId: opt(env, 'SHEETS_ORDERS_ID') ?? req(env, 'GOOGLE_SHEETS_ID'),
        range: opt(env, 'SHEETS_ORDERS_RANGE') ?? 'Orders!A1',
        logStatusChanges: bool(env, 'SHEETS_LOG_STATUS_CHANGES', true),
      }
    : undefined;

  const storageKind = opt(env, 'STORAGE') ?? 'sqlite';
  if (storageKind !== 'sqlite' && storageKind !== 'json') throw new ConfigError('STORAGE must be "sqlite" or "json"');
  const dataDir = (opt(env, 'DATA_DIR') ?? './data').replace(/\/+$/, '');
  const storage = {
    kind: storageKind,
    path: opt(env, 'STORAGE_PATH') ?? `${dataDir}/${storageKind === 'sqlite' ? 'shop.db' : 'shop.json'}`,
  } as const;

  const n8nUrl = opt(env, 'N8N_WEBHOOK_URL');
  const n8nSecret = opt(env, 'N8N_WEBHOOK_SECRET');
  const n8n = n8nUrl ? (n8nSecret ? { url: n8nUrl, secret: n8nSecret } : { url: n8nUrl }) : undefined;

  const insideDistricts = (opt(env, 'INSIDE_DHAKA_DISTRICTS') ?? 'dhaka')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const id of insideDistricts) if (!getDistrict(id)) throw new ConfigError(`INSIDE_DHAKA_DISTRICTS: unknown district "${id}"`);
  const freeAbove = opt(env, 'FREE_DELIVERY_MIN');
  const delivery: DeliveryConfig = {
    insideFee: num(env, 'DELIVERY_FEE_INSIDE_DHAKA', 70, { min: 0 }),
    outsideFee: num(env, 'DELIVERY_FEE_OUTSIDE_DHAKA', 130, { min: 0 }),
    insideDistricts,
  };
  if (freeAbove !== undefined) delivery.freeAbove = num(env, 'FREE_DELIVERY_MIN', 0, { min: 0 });

  const bkashRaw = opt(env, 'BKASH_NUMBER');
  let bkashNumber: string | undefined;
  if (bkashRaw) {
    const phone = normaliseBdPhone(bkashRaw);
    if (!phone) throw new ConfigError('BKASH_NUMBER must be a Bangladeshi mobile number');
    bkashNumber = phone.local;
  }

  const logLevel = (opt(env, 'LOG_LEVEL') ?? 'info') as LogLevel;
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) throw new ConfigError('LOG_LEVEL must be debug, info, warn or error');

  const config: AppConfig = {
    botToken,
    shopName: opt(env, 'SHOP_NAME') ?? 'Our Shop',
    defaultLang,
    adminChatId: Number(adminChatIdRaw),
    adminUserIds,
    mode,
    catalog,
    storage,
    delivery,
    rateLimit: {
      ...DEFAULT_RATE_LIMIT,
      capacity: num(env, 'RATE_LIMIT_BURST', DEFAULT_RATE_LIMIT.capacity, { min: 1, int: true }),
      refillPerSecond: num(env, 'RATE_LIMIT_PER_SECOND', DEFAULT_RATE_LIMIT.refillPerSecond, { min: 0.01 }),
      muteMs: num(env, 'SPAM_MUTE_MINUTES', DEFAULT_RATE_LIMIT.muteMs / 60_000, { min: 1 }) * 60_000,
    },
    logLevel,
  };
  if (webhook) config.webhook = webhook;
  if (google) config.google = google;
  if (ordersSheet) config.ordersSheet = ordersSheet;
  if (n8n) config.n8n = n8n;
  if (bkashNumber) config.bkashNumber = bkashNumber;
  return config;
}
