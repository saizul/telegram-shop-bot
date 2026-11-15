// Embed the bot in your own Node.js process and add a custom order sink.
// Build first (npm run build), then:
//   TELEGRAM_BOT_TOKEN=... ADMIN_CHAT_ID=... node examples/embed-custom-sink.mjs
import {
  CatalogService,
  HttpTelegramApi,
  JsonCatalogSource,
  JsonStore,
  OrderEvents,
  RateLimiter,
  ShopBot,
  runPolling,
} from '../dist/src/index.js';

const logger = console;
const api = new HttpTelegramApi({ token: process.env.TELEGRAM_BOT_TOKEN });

// Any object with a name and an async handle(event) method can receive order events.
const consoleSink = {
  name: 'console',
  async handle(event) {
    console.log(`[${event.type}] ${event.order.id} ${event.order.status} total=${event.order.total}`);
  },
};

const bot = new ShopBot({
  api,
  store: new JsonStore('./data/embedded-shop.json'),
  catalog: new CatalogService(new JsonCatalogSource(new URL('./catalog.json', import.meta.url).pathname)),
  events: new OrderEvents([consoleSink], logger),
  rateLimiter: new RateLimiter(),
  logger,
  config: {
    shopName: 'Embedded Shop',
    defaultLang: 'bn',
    adminChatId: Number(process.env.ADMIN_CHAT_ID),
    adminUserIds: [],
    delivery: { insideFee: 60, outsideFee: 120, insideDistricts: ['dhaka', 'gazipur', 'narayanganj'] },
    bkashNumber: process.env.BKASH_NUMBER,
  },
});

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
await runPolling({ api, handle: (u) => bot.handleUpdate(u), logger, signal: controller.signal });
