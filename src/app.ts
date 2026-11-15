import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { ShopBot } from './bot/bot.js';
import { CatalogService } from './catalog/service.js';
import { JsonCatalogSource, SheetsCatalogSource } from './catalog/sources.js';
import type { CatalogSource } from './catalog/types.js';
import { loadConfig, type AppConfig } from './config.js';
import { ServiceAccountAuth, parseServiceAccount } from './google/auth.js';
import { GoogleSheetsClient, type SheetsClient } from './google/sheets.js';
import { COMMANDS } from './i18n/strings.js';
import { OrderEvents, type OrderEventSink } from './integrations/events.js';
import { WebhookSink } from './integrations/n8n.js';
import { SheetsOrderSink } from './integrations/sheets-export.js';
import { createLogger, type Logger } from './logger.js';
import { RateLimiter } from './security/rate-limit.js';
import { ALLOWED_UPDATES, runPolling } from './server/polling.js';
import { startWebhookServer } from './server/webhook.js';
import { JsonStore } from './store/json.js';
import { openSqliteStore } from './store/sqlite.js';
import type { Store } from './store/types.js';
import { HttpTelegramApi, type TelegramApi } from './telegram/api.js';

export interface App {
  bot: ShopBot;
  api: TelegramApi;
  store: Store;
  config: AppConfig;
  logger: Logger;
  start(): Promise<void>;
  stop(): Promise<void>;
}

async function openStore(config: AppConfig): Promise<Store> {
  return config.storage.kind === 'sqlite' ? openSqliteStore(config.storage.path) : new JsonStore(config.storage.path);
}

/** Wire every component from configuration. `api` can be replaced (tests, local Bot API server). */
export async function createApp(config: AppConfig, overrides: { api?: TelegramApi; logger?: Logger } = {}): Promise<App> {
  const logger = overrides.logger ?? createLogger(config.logLevel);
  const api = overrides.api ?? new HttpTelegramApi({ token: config.botToken });
  const store = await openStore(config);

  let sheets: SheetsClient | undefined;
  if (config.google) {
    sheets = new GoogleSheetsClient(new ServiceAccountAuth({ key: parseServiceAccount(config.google.serviceAccountJson) }));
  }

  const source: CatalogSource =
    config.catalog.source === 'json'
      ? new JsonCatalogSource(config.catalog.file)
      : new SheetsCatalogSource(sheets!, {
          spreadsheetId: config.catalog.spreadsheetId,
          productsRange: config.catalog.productsRange,
          categoriesRange: config.catalog.categoriesRange,
        });
  const catalog = new CatalogService(source, { ttlMs: config.catalog.ttlMs, logger });

  const sinks: OrderEventSink[] = [];
  if (config.ordersSheet && sheets) sinks.push(new SheetsOrderSink(sheets, config.ordersSheet));
  if (config.n8n) sinks.push(new WebhookSink(config.n8n));
  const events = new OrderEvents(sinks, logger);

  const limiter = new RateLimiter(config.rateLimit);
  const botConfig = {
    shopName: config.shopName,
    defaultLang: config.defaultLang,
    adminChatId: config.adminChatId,
    adminUserIds: config.adminUserIds,
    delivery: config.delivery,
    ...(config.bkashNumber ? { bkashNumber: config.bkashNumber } : {}),
  };
  const bot = new ShopBot({ api, store, catalog, events, config: botConfig, rateLimiter: limiter, logger });

  const abort = new AbortController();
  let server: Server | undefined;
  let polling: Promise<void> | undefined;
  let sweeper: NodeJS.Timeout | undefined;

  return {
    bot,
    api,
    store,
    config,
    logger,
    async start() {
      await catalog.get(); // fail fast on a broken catalogue
      const me = await api.getMe();
      await api.setMyCommands({ commands: COMMANDS.en });
      await api.setMyCommands({ commands: COMMANDS.bn, language_code: 'bn' });
      sweeper = setInterval(() => limiter.sweep(), 10 * 60_000);
      sweeper.unref();
      if (config.mode === 'webhook') {
        const wh = config.webhook!;
        server = await startWebhookServer({
          port: wh.port,
          host: wh.host,
          path: wh.path,
          secretToken: wh.secretToken,
          handle: (u) => bot.handleUpdate(u),
          logger,
        });
        await api.setWebhook({
          url: `${wh.publicUrl}${wh.path}`,
          secret_token: wh.secretToken,
          allowed_updates: ALLOWED_UPDATES,
          max_connections: 40,
        });
        logger.info('bot started', { bot: me.username, mode: 'webhook', port: wh.port, path: wh.path });
      } else {
        logger.info('bot started', { bot: me.username, mode: 'polling' });
        polling = runPolling({ api, handle: (u) => bot.handleUpdate(u), logger, signal: abort.signal });
      }
    },
    async stop() {
      abort.abort();
      if (sweeper) clearInterval(sweeper);
      if (server) await new Promise<void>((r) => server!.close(() => r()));
      await polling?.catch(() => undefined);
      await store.close();
      logger.info('bot stopped');
    },
  };
}

/** Entry point used by `src/main.ts`. */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<App> {
  const config = loadConfig(env, (path) => readFileSync(path, 'utf8'));
  const app = await createApp(config);
  const shutdown = (signal: string) => {
    app.logger.info('shutting down', { signal });
    app.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  await app.start();
  return app;
}
