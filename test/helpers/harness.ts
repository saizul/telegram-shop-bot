import { ShopBot, type ShopBotConfig } from '../../src/bot/bot.js';
import { CatalogService } from '../../src/catalog/service.js';
import { parseCatalogObject } from '../../src/catalog/sources.js';
import type { CatalogSource } from '../../src/catalog/types.js';
import { OrderEvents, type OrderEvent, type OrderEventSink } from '../../src/integrations/events.js';
import { RateLimiter, type RateLimitConfig } from '../../src/security/rate-limit.js';
import { JsonStore } from '../../src/store/json.js';
import type { Store } from '../../src/store/types.js';
import type { InlineKeyboardMarkup, Message, Update, User } from '../../src/telegram/types.js';
import { FakeTelegramApi } from './fake-api.js';

export const ADMIN_CHAT = -1001234567890;
export const ADMIN_USER = 999;

export const CATALOG = {
  categories: [
    { id: 'saree', name_en: 'Sarees', name_bn: 'শাড়ি', sort: 1 },
    { id: 'tea', name_en: 'Tea', name_bn: 'চা', sort: 2 },
  ],
  products: [
    {
      id: 'jamdani-01',
      category: 'saree',
      name_en: 'Dhakai Jamdani',
      name_bn: 'ঢাকাই জামদানি',
      description_en: 'Handwoven cotton jamdani.',
      description_bn: 'হাতে বোনা সুতি জামদানি।',
      price: 4500,
      sale_price: 3990,
      photo: 'https://example.com/jamdani.jpg',
      stock: 3,
    },
    { id: 'tangail-02', category: 'saree', name_en: 'Tangail Tant', name_bn: 'টাঙ্গাইল তাঁত', price: 1850 },
    { id: 'tea-500', category: 'tea', name_en: 'Sylhet Tea 500g', name_bn: 'সিলেটের চা ৫০০ গ্রাম', price: '৳৩৫০', stock: 50 },
    { id: 'tea-gift', category: 'tea', name_en: 'Tea Gift Box', name_bn: 'চা উপহার বাক্স', price: 900, stock: 0 },
    { id: 'old-item', category: 'tea', name_en: 'Old item', price: 10, active: 'no' },
  ],
};

export class MemorySink implements OrderEventSink {
  readonly name = 'memory';
  events: OrderEvent[] = [];
  async handle(event: OrderEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }
}

export interface HarnessOptions {
  config?: Partial<ShopBotConfig>;
  catalog?: object;
  store?: Store;
  rateLimit?: Partial<RateLimitConfig> | false;
  now?: () => Date;
}

export function createHarness(options: HarnessOptions = {}) {
  const api = new FakeTelegramApi();
  const store = options.store ?? new JsonStore();
  let catalogData: object = options.catalog ?? CATALOG;
  const source: CatalogSource = { name: 'test', load: async () => parseCatalogObject(structuredClone(catalogData)) };
  const catalog = new CatalogService(source, { ttlMs: 60_000 });
  const sink = new MemorySink();
  let clock = options.now ?? (() => new Date('2026-11-15T06:00:00Z'));
  let orderSeq = 0;
  const bot = new ShopBot({
    api,
    store,
    catalog,
    events: new OrderEvents([sink], { debug() {}, info() {}, warn() {}, error() {} }),
    config: {
      shopName: 'Test <Shop>',
      defaultLang: 'en',
      adminChatId: ADMIN_CHAT,
      adminUserIds: [],
      delivery: { insideFee: 70, outsideFee: 130, insideDistricts: ['dhaka'] },
      bkashNumber: '01711000000',
      ...options.config,
    },
    ...(options.rateLimit === false ? {} : { rateLimiter: new RateLimiter(options.rateLimit ?? { capacity: 1000, refillPerSecond: 1000 }, () => clock().getTime()) }),
    now: () => clock(),
    newOrderId: () => `ORD-261115-${['A2B3', 'C4D5', 'E6F7', 'G8H9'][orderSeq++ % 4]}`,
  });

  let updateId = 1;
  let messageId = 1;
  const user = (id = 42, extra: Partial<User> = {}): User => ({ id, is_bot: false, first_name: 'Rahim', username: 'rahim', ...extra });

  const h = {
    api,
    store,
    bot,
    sink,
    catalog,
    setCatalog(data: object) {
      catalogData = data;
      return catalog.refresh();
    },
    setClock(fn: () => Date) {
      clock = fn;
    },
    user,
    /** Send a private text message. */
    async text(text: string, from: User = user()) {
      const update: Update = {
        update_id: updateId++,
        message: { message_id: messageId++, date: 0, chat: { id: from.id, type: 'private' }, from, text },
      };
      await bot.handleUpdate(update);
      return update;
    },
    async contact(phone: string, from: User = user(), contactUserId: number | undefined = from.id) {
      const contact = { phone_number: phone, first_name: from.first_name, ...(contactUserId !== undefined ? { user_id: contactUserId } : {}) };
      await bot.handleUpdate({
        update_id: updateId++,
        message: { message_id: messageId++, date: 0, chat: { id: from.id, type: 'private' }, from, contact },
      });
    },
    /** Press an inline button. `on` is the message the button belongs to. */
    async press(data: string, opts: { from?: User; on?: Message; chatId?: number } = {}) {
      const from = opts.from ?? user();
      const chatId = opts.chatId ?? from.id;
      const message: Message = opts.on ?? { message_id: messageId++, date: 0, chat: { id: chatId, type: chatId < 0 ? 'supergroup' : 'private' }, text: 'x' };
      await bot.handleUpdate({ update_id: updateId++, callback_query: { id: `cq${updateId}`, from, chat_instance: 'ci', message, data } });
    },
    async group(text: string, chatId = ADMIN_CHAT, from: User = user(ADMIN_USER)) {
      await bot.handleUpdate({
        update_id: updateId++,
        message: { message_id: messageId++, date: 0, chat: { id: chatId, type: 'supergroup' }, from, text },
      });
    },
    raw(update: Update) {
      return bot.handleUpdate(update);
    },
    /** Callback data of every button in a keyboard. */
    buttons(markup: unknown): string[] {
      const kb = markup as InlineKeyboardMarkup | undefined;
      return kb?.inline_keyboard.flat().map((b) => b.callback_data ?? b.url ?? '') ?? [];
    },
    lastText(): string {
      return api.texts().at(-1) ?? '';
    },
    /** Walk the whole checkout for user 42 with COD, returning the summary text. */
    async checkoutCod(opts: { district?: string; from?: User } = {}) {
      const from = opts.from ?? user();
      await h.press('a:tangail-02', { from });
      await h.press('co', { from });
      await h.text('Rahim Uddin', from);
      await h.text('01712-345678', from);
      await h.press('dv:dhaka', { from });
      await h.press(`dd:${opts.district ?? 'dhaka'}`, { from });
      await h.text('House 12, Road 5, Dhanmondi, Dhaka', from);
      await h.press('pm:cod', { from });
      return h.lastText();
    },
  };
  return h;
}

export type Harness = ReturnType<typeof createHarness>;
