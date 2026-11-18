import { findDistrict, getDistrict } from '../bd/districts.js';
import { formatTaka } from '../bd/money.js';
import { normaliseBdPhone } from '../bd/phone.js';
import type { CatalogService } from '../catalog/service.js';
import { localized } from '../catalog/types.js';
import { t, type Lang, type StringKey } from '../i18n/strings.js';
import type { OrderEvents } from '../integrations/events.js';
import { silentLogger, type Logger } from '../logger.js';
import { KeyedQueue, RecentIds } from '../security/keyed-queue.js';
import type { RateLimiter } from '../security/rate-limit.js';
import { changeQty, priceCart, setQty, type PricedCart } from '../shop/cart.js';
import { deliveryFee, type DeliveryConfig } from '../shop/delivery.js';
import { canTransition, generateOrderId, isOrderAction, ORDER_ID_RE, targetStatus } from '../shop/orders.js';
import type { CheckoutDraft, Order, PaymentMethod, Session } from '../shop/types.js';
import { validateAddress, validateBkashTrxId, validateName } from '../shop/validate.js';
import type { Store } from '../store/types.js';
import { TelegramApiError, type TelegramApi } from '../telegram/api.js';
import { escapeHtml, truncate } from '../telegram/format.js';
import { LIMITS, type CallbackQuery, type Message, type Update, type User } from '../telegram/types.js';
import * as V from './views.js';

export interface ShopBotConfig {
  shopName: string;
  defaultLang: Lang;
  adminChatId: number;
  /** Empty: anyone in the admin chat may press order buttons. */
  adminUserIds: number[];
  delivery: DeliveryConfig;
  bkashNumber?: string;
  /** Unfinished checkouts expire after this long. Default 2 hours. */
  checkoutTtlMs?: number;
}

export interface ShopBotDeps {
  api: TelegramApi;
  store: Store;
  catalog: CatalogService;
  events: OrderEvents;
  config: ShopBotConfig;
  rateLimiter?: RateLimiter;
  logger?: Logger;
  now?: () => Date;
  newOrderId?: () => string;
}

/** Per-update context passed to handlers. */
interface Ctx {
  user: User;
  chatId: number;
  session: Session;
  lang: Lang;
  /** The message a callback button was attached to. */
  message?: Message;
  callback?: CallbackQuery;
  answered: boolean;
}

const DEFAULT_CHECKOUT_TTL = 2 * 3600_000;
/** Shorter free text is answered with the menu hint instead of a search. */
const MIN_SEARCH_LENGTH = 2;

/**
 * The shop bot. Feed it Telegram updates with `handleUpdate`; it talks back through the
 * injected `TelegramApi`. All state lives in the `Store`, so the process can restart freely.
 */
export class ShopBot {
  private readonly api: TelegramApi;
  private readonly store: Store;
  private readonly catalog: CatalogService;
  private readonly events: OrderEvents;
  private readonly config: ShopBotConfig;
  private readonly limiter: RateLimiter | undefined;
  private readonly log: Logger;
  private readonly now: () => Date;
  private readonly newOrderId: () => string;
  private readonly queue = new KeyedQueue();
  private readonly seen = new RecentIds(2000);

  constructor(deps: ShopBotDeps) {
    this.api = deps.api;
    this.store = deps.store;
    this.catalog = deps.catalog;
    this.events = deps.events;
    this.config = deps.config;
    this.limiter = deps.rateLimiter;
    this.log = deps.logger ?? silentLogger;
    this.now = deps.now ?? (() => new Date());
    this.newOrderId = deps.newOrderId ?? (() => generateOrderId(this.now()));
  }

  /** Process one update. Never throws; errors are logged and the user gets a generic message. */
  async handleUpdate(update: Update): Promise<void> {
    if (!this.seen.add(update.update_id)) {
      this.log.debug('duplicate update ignored', { updateId: update.update_id });
      return;
    }
    const from = update.callback_query?.from ?? update.message?.from;
    if (!from || from.is_bot) return;
    await this.queue.run(from.id, () => this.dispatch(update, from));
  }

  private async dispatch(update: Update, user: User): Promise<void> {
    let ctx: Ctx | undefined;
    try {
      if (update.callback_query) {
        const cq = update.callback_query;
        const chatId = cq.message?.chat.id ?? user.id;
        ctx = await this.context(user, chatId, cq.message, cq);
        if (!this.isAdminChat(chatId) && !(await this.allow(ctx))) return;
        await this.onCallback(ctx, cq.data ?? '');
      } else if (update.message) {
        const msg = update.message;
        if (msg.chat.type !== 'private') {
          await this.onGroupMessage(msg);
          return;
        }
        ctx = await this.context(user, msg.chat.id, undefined, undefined);
        if (!(await this.allow(ctx, msg.text ?? msg.caption ?? ''))) return;
        await this.onMessage(ctx, msg);
      }
    } catch (err) {
      this.log.error('update failed', { updateId: update.update_id, userId: user.id, error: (err as Error).stack ?? String(err) });
      if (ctx) {
        try {
          if (ctx.callback && !ctx.answered) await this.answer(ctx, t(ctx.lang, 'error.generic'), true);
          else await this.send(ctx, { text: t(ctx.lang, 'error.generic') });
        } catch {
          /* nothing more we can do */
        }
      }
    } finally {
      if (ctx?.callback && !ctx.answered) {
        // Telegram shows a spinner until every callback query is answered.
        await this.api.answerCallbackQuery({ callback_query_id: ctx.callback.id }).catch(() => undefined);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Context, rate limiting, sending helpers

  private async context(user: User, chatId: number, message: Message | undefined, callback: CallbackQuery | undefined): Promise<Ctx> {
    let session = await this.store.getSession(user.id);
    if (!session) {
      const lang: Lang = user.language_code?.startsWith('bn') ? 'bn' : this.config.defaultLang;
      session = { userId: user.id, chatId, lang, updatedAt: this.now().getTime() };
    }
    // Admin button presses happen in the group; keep the customer's private chat id.
    if (!this.isAdminChat(chatId)) session.chatId = chatId;
    const ctx: Ctx = { user, chatId, session, lang: session.lang, answered: false };
    if (message) ctx.message = message;
    if (callback) ctx.callback = callback;
    return ctx;
  }

  private async saveSession(ctx: Ctx): Promise<void> {
    ctx.session.updatedAt = this.now().getTime();
    ctx.session.lang = ctx.lang;
    await this.store.saveSession(ctx.session);
  }

  private isAdminChat(chatId: number): boolean {
    return chatId === this.config.adminChatId;
  }

  private async allow(ctx: Ctx, text?: string): Promise<boolean> {
    if (!this.limiter) return true;
    const verdict = this.limiter.check(ctx.user.id, text);
    if (verdict.allowed) return true;
    this.log.warn('rate limited', { userId: ctx.user.id, reason: verdict.reason });
    if (ctx.callback) {
      await this.answer(ctx, t(ctx.lang, 'rate.slowDown'));
    } else if (verdict.notify) {
      const key: StringKey = verdict.reason === 'muted' || verdict.reason === 'repeat' ? 'rate.muted' : 'rate.slowDown';
      await this.api.sendMessage({
        chat_id: ctx.chatId,
        text: t(ctx.lang, key, { minutes: Math.max(1, Math.ceil(verdict.retryAfterMs / 60_000)) }),
      });
    }
    return false;
  }

  private async answer(ctx: Ctx, text?: string, alert = false): Promise<void> {
    if (!ctx.callback || ctx.answered) return;
    ctx.answered = true;
    await this.api.answerCallbackQuery({
      callback_query_id: ctx.callback.id,
      ...(text ? { text: truncate(text, LIMITS.callbackAnswer) } : {}),
      ...(alert ? { show_alert: true } : {}),
    });
  }

  /** Send a new message or photo. */
  private async send(ctx: Ctx, screen: V.Screen): Promise<Message> {
    if (screen.photo) {
      try {
        return await this.api.sendPhoto({
          chat_id: ctx.chatId,
          photo: screen.photo,
          caption: screen.text,
          parse_mode: 'HTML',
          ...(screen.keyboard ? { reply_markup: screen.keyboard } : {}),
        });
      } catch (err) {
        // A broken photo URL should not stop the sale: fall back to text.
        this.log.warn('sendPhoto failed, sending text', { error: (err as Error).message });
      }
    }
    return this.api.sendMessage({
      chat_id: ctx.chatId,
      text: screen.text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(screen.keyboard ? { reply_markup: screen.keyboard } : {}),
    });
  }

  /**
   * Show a screen in place of the message the button was on. Text-to-text is an edit;
   * anything involving a photo replaces the message (Telegram cannot turn a photo into text).
   */
  private async show(ctx: Ctx, screen: V.Screen): Promise<void> {
    const msg = ctx.message;
    if (!msg) {
      await this.send(ctx, screen);
      return;
    }
    const isPhoto = Boolean(msg.photo?.length);
    if (!isPhoto && !screen.photo) {
      try {
        await this.api.editMessageText({
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          text: screen.text,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...(screen.keyboard ? { reply_markup: screen.keyboard } : {}),
        });
        return;
      } catch (err) {
        if (err instanceof TelegramApiError && err.isNotModified) return;
        this.log.debug('edit failed, sending new message', { error: (err as Error).message });
      }
    } else {
      await this.api.deleteMessage({ chat_id: msg.chat.id, message_id: msg.message_id }).catch(() => undefined);
    }
    await this.send(ctx, screen);
  }

  private async editKeyboard(ctx: Ctx, keyboard: V.Screen['keyboard']): Promise<void> {
    if (!ctx.message) return;
    try {
      await this.api.editMessageReplyMarkup({
        chat_id: ctx.message.chat.id,
        message_id: ctx.message.message_id,
        ...(keyboard ? { reply_markup: keyboard } : {}),
      });
    } catch (err) {
      if (!(err instanceof TelegramApiError && err.isNotModified)) throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Messages

  private async onGroupMessage(msg: Message): Promise<void> {
    // Helps the owner find the admin group id during setup.
    const cmd = commandOf(msg.text);
    if (cmd === 'chatid') {
      await this.api.sendMessage({ chat_id: msg.chat.id, text: `Chat ID: <code>${msg.chat.id}</code>`, parse_mode: 'HTML' });
    }
  }

  private async onMessage(ctx: Ctx, msg: Message): Promise<void> {
    const cmd = commandOf(msg.text);
    if (cmd === 'search') {
      await this.search(ctx, commandArgs(msg.text));
      return;
    }
    if (cmd) {
      await this.onCommand(ctx, cmd);
      return;
    }
    if (ctx.session.checkout) {
      if (this.checkoutExpired(ctx.session.checkout)) {
        delete ctx.session.checkout;
        await this.saveSession(ctx);
        await this.send(ctx, { text: t(ctx.lang, 'checkout.expired') });
        return;
      }
      await this.onCheckoutInput(ctx, msg);
      return;
    }
    const text = (msg.text ?? '').trim();
    if ([...text].length >= MIN_SEARCH_LENGTH) {
      // Free text outside checkout is treated as a product search ("jamdani", "চা").
      await this.search(ctx, text);
      return;
    }
    await this.send(ctx, { text: t(ctx.lang, 'unknown.text'), keyboard: V.menuKeyboard(ctx.lang, await this.cartCount(ctx)) });
  }

  private async search(ctx: Ctx, query: string): Promise<void> {
    if ([...query.trim()].length < MIN_SEARCH_LENGTH) {
      await this.send(ctx, { text: t(ctx.lang, 'search.usage') });
      return;
    }
    await this.send(ctx, V.searchScreen(ctx.lang, query, await this.catalog.search(query)));
  }

  private async onCommand(ctx: Ctx, cmd: string): Promise<void> {
    switch (cmd) {
      case 'start':
        await this.saveSession(ctx);
        await this.send(ctx, V.mainMenu(ctx.lang, this.config.shopName, await this.cartCount(ctx)));
        return;
      case 'shop':
        await this.send(ctx, V.categoriesScreen(ctx.lang, await this.catalog.categories()));
        return;
      case 'cart':
        await this.send(ctx, V.cartScreen(ctx.lang, await this.pricedCart(ctx)));
        return;
      case 'orders':
        await this.send(ctx, V.ordersScreen(ctx.lang, await this.store.listOrders(ctx.user.id, 5)));
        return;
      case 'help':
        await this.send(ctx, V.helpScreen(ctx.lang));
        return;
      case 'language':
      case 'lang':
        await this.setLang(ctx, ctx.lang === 'bn' ? 'en' : 'bn', false);
        return;
      case 'cancel':
        if (!ctx.session.checkout) {
          await this.send(ctx, { text: t(ctx.lang, 'checkout.noCheckout') });
          return;
        }
        delete ctx.session.checkout;
        await this.saveSession(ctx);
        await this.api.sendMessage({ chat_id: ctx.chatId, text: t(ctx.lang, 'checkout.cancelled'), reply_markup: { remove_keyboard: true } });
        return;
      default:
        await this.send(ctx, { text: t(ctx.lang, 'unknown.text') });
    }
  }

  // ---------------------------------------------------------------------------
  // Callback buttons

  private async onCallback(ctx: Ctx, data: string): Promise<void> {
    const [head = '', a = '', b = ''] = data.split(':');
    if (head === 'o') {
      await this.onAdminAction(ctx, a, b);
      return;
    }
    if (this.isAdminChat(ctx.chatId)) {
      await this.answer(ctx);
      return;
    }
    switch (head) {
      case 'noop':
        return;
      case V.CB.menu:
        await this.show(ctx, V.mainMenu(ctx.lang, this.config.shopName, await this.cartCount(ctx)));
        return;
      case V.CB.help:
        await this.show(ctx, V.helpScreen(ctx.lang));
        return;
      case V.CB.orders:
        await this.show(ctx, V.ordersScreen(ctx.lang, await this.store.listOrders(ctx.user.id, 5)));
        return;
      case 'l':
        if (a === 'bn' || a === 'en') await this.setLang(ctx, a, true);
        return;
      case 'c':
        await this.showCatalog(ctx, a, Number(b) || 0);
        return;
      case 'p':
        await this.showProduct(ctx, a);
        return;
      case 'a':
      case 'r':
        await this.changeFromProduct(ctx, a, head === 'a' ? 1 : -1);
        return;
      case V.CB.cart:
        await this.show(ctx, V.cartScreen(ctx.lang, await this.pricedCart(ctx)));
        return;
      case 'ci':
      case 'cd':
      case 'cr':
        await this.changeFromCart(ctx, a, head);
        return;
      case V.CB.cartClear:
        await this.store.setCart(ctx.user.id, []);
        await this.answer(ctx, t(ctx.lang, 'cart.cleared'));
        await this.show(ctx, V.cartScreen(ctx.lang, await this.pricedCart(ctx)));
        return;
      case V.CB.checkout:
        await this.startCheckout(ctx);
        return;
      case 'cp':
        await this.onProfileChoice(ctx, a === 'use');
        return;
      case 'dv':
        await this.onDivision(ctx, a);
        return;
      case V.CB.divisions:
        await this.show(ctx, V.divisionsScreen(ctx.lang));
        return;
      case 'dd':
        await this.onDistrictChosen(ctx, a);
        return;
      case 'pm':
        if (a === 'cod' || a === 'bkash') await this.onPayment(ctx, a);
        return;
      case V.CB.confirm:
        await this.placeOrder(ctx);
        return;
      case V.CB.cancel:
        delete ctx.session.checkout;
        await this.saveSession(ctx);
        await this.answer(ctx);
        await this.show(ctx, { text: t(ctx.lang, 'checkout.cancelled') });
        return;
      default:
        this.log.debug('unknown callback', { data });
    }
  }

  private async setLang(ctx: Ctx, lang: Lang, edit: boolean): Promise<void> {
    ctx.lang = lang;
    await this.saveSession(ctx);
    await this.answer(ctx, t(lang, 'lang.changed'));
    const menu = V.mainMenu(lang, this.config.shopName, await this.cartCount(ctx));
    if (edit) await this.show(ctx, menu);
    else await this.send(ctx, { ...menu, text: `${t(lang, 'lang.changed')}\n\n${menu.text}` });
  }

  private async showCatalog(ctx: Ctx, categoryId: string, page: number): Promise<void> {
    if (!categoryId) {
      await this.show(ctx, V.categoriesScreen(ctx.lang, await this.catalog.categories()));
      return;
    }
    const category = await this.catalog.category(categoryId);
    if (!category) {
      await this.answer(ctx, t(ctx.lang, 'catalog.unavailable'));
      await this.show(ctx, V.categoriesScreen(ctx.lang, await this.catalog.categories()));
      return;
    }
    await this.show(ctx, V.categoryScreen(ctx.lang, category, await this.catalog.productsIn(categoryId), page));
  }

  private async showProduct(ctx: Ctx, productId: string): Promise<void> {
    const product = await this.catalog.product(productId);
    if (!product) {
      await this.answer(ctx, t(ctx.lang, 'catalog.unavailable'), true);
      return;
    }
    const cart = await this.store.getCart(ctx.user.id);
    await this.show(ctx, V.productScreen(ctx.lang, product, cart.find((i) => i.productId === productId)?.qty ?? 0));
  }

  private cartChangeMessage(ctx: Ctx, reason: string, limit?: number): string {
    switch (reason) {
      case 'out-of-stock':
        return t(ctx.lang, 'product.outOfStock');
      case 'stock-limit':
        return t(ctx.lang, 'cart.limit', { stock: limit ?? 0 });
      default:
        return t(ctx.lang, 'cart.maxQty', { max: limit ?? 0 });
    }
  }

  private async changeFromProduct(ctx: Ctx, productId: string, delta: 1 | -1): Promise<void> {
    const product = await this.catalog.product(productId);
    if (!product) {
      await this.answer(ctx, t(ctx.lang, 'catalog.unavailable'), true);
      return;
    }
    const cart = await this.store.getCart(ctx.user.id);
    const result = changeQty(cart, product, delta);
    if (!result.ok) {
      await this.answer(ctx, this.cartChangeMessage(ctx, result.reason, result.limit), true);
      return;
    }
    await this.store.setCart(ctx.user.id, result.items);
    await this.answer(ctx, delta > 0 ? t(ctx.lang, 'cart.added', { name: localized(product.name, ctx.lang) }) : t(ctx.lang, 'cart.removed'));
    await this.editKeyboard(ctx, V.productKeyboard(ctx.lang, product, result.qty));
  }

  private async changeFromCart(ctx: Ctx, productId: string, op: string): Promise<void> {
    const cart = await this.store.getCart(ctx.user.id);
    if (op === 'cr') {
      await this.store.setCart(ctx.user.id, setQty(cart, productId, 0));
      await this.answer(ctx, t(ctx.lang, 'cart.removed'));
    } else {
      const product = await this.catalog.product(productId);
      if (!product) {
        await this.store.setCart(ctx.user.id, setQty(cart, productId, 0));
        await this.answer(ctx, t(ctx.lang, 'catalog.unavailable'), true);
      } else {
        const result = changeQty(cart, product, op === 'ci' ? 1 : -1);
        if (!result.ok) {
          await this.answer(ctx, this.cartChangeMessage(ctx, result.reason, result.limit), true);
          return;
        }
        await this.store.setCart(ctx.user.id, result.items);
        await this.answer(ctx);
      }
    }
    await this.show(ctx, V.cartScreen(ctx.lang, await this.pricedCart(ctx)));
  }

  private async pricedCart(ctx: Ctx): Promise<PricedCart> {
    const items = await this.store.getCart(ctx.user.id);
    if (items.length === 0) return priceCart([], () => undefined);
    const catalog = await this.catalog.get();
    const byId = new Map(catalog.products.map((p) => [p.id, p]));
    const priced = priceCart(items, (id) => byId.get(id));
    if (priced.missing.length > 0) {
      // Drop products that were removed from the catalogue.
      await this.store.setCart(ctx.user.id, items.filter((i) => !priced.missing.includes(i.productId)));
    }
    return priced;
  }

  private async cartCount(ctx: Ctx): Promise<number> {
    return (await this.store.getCart(ctx.user.id)).reduce((s, i) => s + i.qty, 0);
  }

  // ---------------------------------------------------------------------------
  // Checkout

  private checkoutExpired(draft: CheckoutDraft): boolean {
    return this.now().getTime() - draft.startedAt > (this.config.checkoutTtlMs ?? DEFAULT_CHECKOUT_TTL);
  }

  private async startCheckout(ctx: Ctx): Promise<void> {
    const cart = await this.pricedCart(ctx);
    if (cart.lines.length === 0) {
      await this.answer(ctx, t(ctx.lang, 'cart.empty'), true);
      return;
    }
    if (cart.overStock.length > 0) {
      await this.answer(ctx, t(ctx.lang, 'checkout.stockChanged'), true);
      return;
    }
    await this.answer(ctx);
    const startedAt = this.now().getTime();
    if (ctx.session.profile && getDistrict(ctx.session.profile.districtId)) {
      ctx.session.checkout = { step: 'profile', startedAt };
      await this.saveSession(ctx);
      await this.send(ctx, V.savedProfileScreen(ctx.lang, ctx.session.profile));
      return;
    }
    ctx.session.checkout = { step: 'name', startedAt };
    await this.saveSession(ctx);
    await this.send(ctx, { text: t(ctx.lang, 'checkout.askName') });
  }

  private requireCheckout(ctx: Ctx): CheckoutDraft | undefined {
    const draft = ctx.session.checkout;
    if (!draft || this.checkoutExpired(draft)) return undefined;
    return draft;
  }

  private async onProfileChoice(ctx: Ctx, useSaved: boolean): Promise<void> {
    const draft = this.requireCheckout(ctx);
    if (!draft || draft.step !== 'profile') {
      await this.answer(ctx, t(ctx.lang, 'checkout.expired'), true);
      return;
    }
    await this.answer(ctx);
    const profile = ctx.session.profile;
    if (useSaved && profile) {
      Object.assign(draft, { name: profile.name, phone: profile.phone, districtId: profile.districtId, address: profile.address });
      await this.askPayment(ctx, draft, true);
      return;
    }
    draft.step = 'name';
    await this.saveSession(ctx);
    await this.show(ctx, { text: t(ctx.lang, 'checkout.askName') });
  }

  private async onCheckoutInput(ctx: Ctx, msg: Message): Promise<void> {
    const draft = ctx.session.checkout!;
    const text = msg.text ?? '';
    switch (draft.step) {
      case 'name': {
        const name = validateName(text);
        if (!name) {
          await this.send(ctx, { text: t(ctx.lang, 'checkout.badName') });
          return;
        }
        draft.name = name;
        draft.step = 'phone';
        await this.saveSession(ctx);
        await this.api.sendMessage({
          chat_id: ctx.chatId,
          text: t(ctx.lang, 'checkout.askPhone'),
          parse_mode: 'HTML',
          reply_markup: {
            keyboard: [[{ text: t(ctx.lang, 'checkout.sharePhone'), request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        });
        return;
      }
      case 'phone': {
        // Only accept a shared contact if it is the user's own number.
        const raw = msg.contact && (msg.contact.user_id === undefined || msg.contact.user_id === ctx.user.id) ? msg.contact.phone_number : text;
        const phone = normaliseBdPhone(raw);
        if (!phone) {
          await this.send(ctx, { text: t(ctx.lang, 'checkout.badPhone') });
          return;
        }
        draft.phone = phone.local;
        draft.step = 'district';
        await this.saveSession(ctx);
        await this.api.sendMessage({ chat_id: ctx.chatId, text: `📱 ${phone.local}`, reply_markup: { remove_keyboard: true } });
        await this.send(ctx, V.divisionsScreen(ctx.lang));
        return;
      }
      case 'district': {
        const district = findDistrict(text);
        if (!district) {
          await this.send(ctx, { text: t(ctx.lang, 'checkout.badDistrict'), keyboard: V.divisionsScreen(ctx.lang).keyboard! });
          return;
        }
        await this.setDistrict(ctx, draft, district.id, false);
        return;
      }
      case 'address': {
        const address = validateAddress(text);
        if (!address) {
          await this.send(ctx, { text: t(ctx.lang, 'checkout.badAddress') });
          return;
        }
        draft.address = address;
        await this.askPayment(ctx, draft, false);
        return;
      }
      case 'bkash': {
        const trx = validateBkashTrxId(text);
        if (!trx) {
          await this.send(ctx, { text: t(ctx.lang, 'checkout.badBkash') });
          return;
        }
        draft.bkashTrxId = trx;
        await this.showSummary(ctx, draft, false);
        return;
      }
      default:
        // Waiting for a button press (profile, payment, confirm): remind with the right screen.
        await this.send(ctx, { text: t(ctx.lang, 'unknown.text') });
    }
  }

  private async onDivision(ctx: Ctx, divisionId: string): Promise<void> {
    const draft = this.requireCheckout(ctx);
    if (!draft || draft.step !== 'district') {
      await this.answer(ctx, t(ctx.lang, 'checkout.expired'), true);
      return;
    }
    draft.divisionId = divisionId;
    await this.saveSession(ctx);
    await this.answer(ctx);
    await this.show(ctx, V.districtsScreen(ctx.lang, divisionId));
  }

  private async onDistrictChosen(ctx: Ctx, districtId: string): Promise<void> {
    const draft = this.requireCheckout(ctx);
    if (!draft || draft.step !== 'district' || !getDistrict(districtId)) {
      await this.answer(ctx, t(ctx.lang, 'checkout.expired'), true);
      return;
    }
    await this.answer(ctx);
    await this.setDistrict(ctx, draft, districtId, true);
  }

  private async setDistrict(ctx: Ctx, draft: CheckoutDraft, districtId: string, fromButton: boolean): Promise<void> {
    const district = getDistrict(districtId)!;
    draft.districtId = districtId;
    draft.step = 'address';
    delete draft.divisionId;
    await this.saveSession(ctx);
    if (fromButton) await this.show(ctx, { text: `📍 ${district[ctx.lang]}` });
    await this.send(ctx, { text: t(ctx.lang, 'checkout.askAddress') });
  }

  private async askPayment(ctx: Ctx, draft: CheckoutDraft, edit: boolean): Promise<void> {
    const cart = await this.pricedCart(ctx);
    if (cart.lines.length === 0) {
      delete ctx.session.checkout;
      await this.saveSession(ctx);
      await this.send(ctx, { text: t(ctx.lang, 'cart.empty') });
      return;
    }
    draft.step = 'payment';
    await this.saveSession(ctx);
    const fee = deliveryFee(draft.districtId!, cart.subtotal, this.config.delivery);
    const screen = V.paymentScreen(ctx.lang, getDistrict(draft.districtId!)![ctx.lang], fee.fee, cart.subtotal + fee.fee, Boolean(this.config.bkashNumber));
    if (edit) await this.show(ctx, screen);
    else await this.send(ctx, screen);
  }

  private async onPayment(ctx: Ctx, method: PaymentMethod): Promise<void> {
    const draft = this.requireCheckout(ctx);
    if (!draft || draft.step !== 'payment') {
      await this.answer(ctx, t(ctx.lang, 'checkout.expired'), true);
      return;
    }
    await this.answer(ctx);
    draft.payment = method;
    if (method === 'bkash') {
      if (!this.config.bkashNumber) return;
      draft.step = 'bkash';
      await this.saveSession(ctx);
      const cart = await this.pricedCart(ctx);
      const fee = deliveryFee(draft.districtId!, cart.subtotal, this.config.delivery);
      await this.show(ctx, V.bkashScreen(ctx.lang, this.config.bkashNumber, cart.subtotal + fee.fee));
      return;
    }
    delete draft.bkashTrxId;
    await this.showSummary(ctx, draft, true);
  }

  private async showSummary(ctx: Ctx, draft: CheckoutDraft, edit: boolean): Promise<void> {
    const cart = await this.pricedCart(ctx);
    draft.step = 'confirm';
    await this.saveSession(ctx);
    const complete = completeDraft(draft);
    if (!complete || cart.lines.length === 0) {
      await this.send(ctx, { text: t(ctx.lang, 'checkout.expired') });
      return;
    }
    const fee = deliveryFee(complete.districtId, cart.subtotal, this.config.delivery);
    const screen = V.summaryScreen(ctx.lang, cart, complete, fee);
    if (edit) await this.show(ctx, screen);
    else await this.send(ctx, screen);
  }

  private async placeOrder(ctx: Ctx): Promise<void> {
    const draft = this.requireCheckout(ctx);
    const complete = draft && draft.step === 'confirm' ? completeDraft(draft) : undefined;
    if (!complete) {
      await this.answer(ctx, t(ctx.lang, 'checkout.expired'), true);
      return;
    }
    // Re-check prices and stock at the moment of ordering.
    await this.catalog.refresh().catch(() => undefined);
    const cart = await this.pricedCart(ctx);
    if (cart.lines.length === 0 || cart.overStock.length > 0 || cart.missing.length > 0) {
      await this.answer(ctx, t(ctx.lang, cart.lines.length === 0 ? 'cart.empty' : 'checkout.stockChanged'), true);
      return;
    }
    const district = getDistrict(complete.districtId)!;
    const fee = deliveryFee(district.id, cart.subtotal, this.config.delivery);
    const nowIso = this.now().toISOString();
    const order: Order = {
      id: this.newOrderId(),
      userId: ctx.user.id,
      chatId: ctx.chatId,
      lang: ctx.lang,
      status: 'pending',
      lines: cart.lines.map((l) => ({
        productId: l.product.id,
        name: l.product.name.en === l.product.name.bn ? l.product.name.en : `${l.product.name.en} / ${l.product.name.bn}`,
        unitPrice: l.unitPrice,
        qty: l.qty,
        total: l.total,
      })),
      subtotal: cart.subtotal,
      deliveryFee: fee.fee,
      total: cart.subtotal + fee.fee,
      zone: fee.zone,
      customer: { name: complete.name, phone: complete.phone, districtId: district.id, district: district.en, address: complete.address },
      payment: complete.payment === 'bkash' ? { method: 'bkash', bkashTrxId: complete.bkashTrxId! } : { method: 'cod' },
      createdAt: nowIso,
      updatedAt: nowIso,
      history: [{ status: 'pending', at: nowIso }],
    };
    if (ctx.user.username) order.username = ctx.user.username;
    await this.store.createOrder(order);
    await this.store.setCart(ctx.user.id, []);
    ctx.session.profile = { name: complete.name, phone: complete.phone, districtId: district.id, address: complete.address };
    delete ctx.session.checkout;
    await this.saveSession(ctx);
    await this.answer(ctx);
    await this.editKeyboard(ctx, undefined);
    await this.send(ctx, {
      text: t(ctx.lang, 'order.placed', {
        id: order.id,
        total: formatTaka(order.total, ctx.lang),
        payment: V.paymentLabel(ctx.lang, order.payment.method, order.payment.bkashTrxId),
        phone: order.customer.phone,
      }),
      keyboard: V.menuKeyboard(ctx.lang, 0),
    });
    this.log.info('order placed', { orderId: order.id, total: order.total, payment: order.payment.method });
    await this.notifyAdmins(order);
    await this.events.emit({ type: 'order.created', order, at: nowIso });
  }

  private async notifyAdmins(order: Order): Promise<void> {
    try {
      const screen = V.adminOrderScreen(order);
      const sent = await this.api.sendMessage({
        chat_id: this.config.adminChatId,
        text: screen.text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(screen.keyboard ? { reply_markup: screen.keyboard } : {}),
      });
      order.adminMessage = { chatId: sent.chat.id, messageId: sent.message_id };
      await this.store.saveOrder(order);
    } catch (err) {
      this.log.error('admin notification failed', { orderId: order.id, error: (err as Error).message });
    }
  }

  // ---------------------------------------------------------------------------
  // Admin order actions

  private async onAdminAction(ctx: Ctx, orderId: string, action: string): Promise<void> {
    const authorised =
      this.isAdminChat(ctx.chatId) && (this.config.adminUserIds.length === 0 || this.config.adminUserIds.includes(ctx.user.id));
    if (!authorised) {
      this.log.warn('unauthorised admin action', { userId: ctx.user.id, chatId: ctx.chatId, orderId, action });
      await this.answer(ctx, t(ctx.lang, 'admin.only'), true);
      return;
    }
    if (!ORDER_ID_RE.test(orderId) || !isOrderAction(action)) {
      await this.answer(ctx, t('en', 'admin.notFound'), true);
      return;
    }
    const order = await this.store.getOrder(orderId);
    if (!order) {
      await this.answer(ctx, t('en', 'admin.notFound'), true);
      return;
    }
    const to = targetStatus(action);
    const previous = order.status;
    if (!canTransition(previous, to)) {
      await this.answer(ctx, t('en', 'admin.badTransition', { id: order.id, status: V.statusLabel('en', previous).toLowerCase() }), true);
      await this.refreshAdminMessage(ctx, order);
      return;
    }
    const at = this.now().toISOString();
    order.status = to;
    order.updatedAt = at;
    order.history.push({ status: to, at, by: ctx.user.id });
    await this.store.saveOrder(order);
    await this.answer(ctx, t('en', 'admin.updated', { id: order.id, status: V.statusLabel('en', to) }));
    await this.refreshAdminMessage(ctx, order);
    this.log.info('order status changed', { orderId: order.id, from: previous, to, by: ctx.user.id });

    const key = `order.update.${to}` as StringKey;
    try {
      await this.api.sendMessage({
        chat_id: order.chatId,
        text: t(order.lang, key, { id: order.id, total: formatTaka(order.total, order.lang) }),
        parse_mode: 'HTML',
      });
    } catch (err) {
      // The customer may have blocked the bot; the status change still stands.
      this.log.warn('customer notification failed', { orderId: order.id, error: (err as Error).message });
    }
    await this.events.emit({ type: 'order.status_changed', order, previousStatus: previous, by: ctx.user.id, at });
  }

  private async refreshAdminMessage(ctx: Ctx, order: Order): Promise<void> {
    if (!ctx.message) return;
    const screen = V.adminOrderScreen(order);
    try {
      await this.api.editMessageText({
        chat_id: ctx.message.chat.id,
        message_id: ctx.message.message_id,
        text: `${screen.text}\n\n<i>Last update by ${escapeHtml(ctx.user.first_name)}</i>`,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(screen.keyboard ? { reply_markup: screen.keyboard } : {}),
      });
    } catch (err) {
      if (!(err instanceof TelegramApiError && err.isNotModified)) throw err;
    }
  }
}

/** `/start@MyShopBot arg` -> `start`. Returns undefined for non-commands. */
export function commandOf(text: string | undefined): string | undefined {
  const m = /^\/([a-z0-9_]{1,32})(?:@\w+)?(?:\s|$)/i.exec(text ?? '');
  return m ? m[1]!.toLowerCase() : undefined;
}

/** `/search@MyShopBot red saree` -> `red saree`. Empty for non-commands or commands without text. */
export function commandArgs(text: string | undefined): string {
  const m = /^\/[a-z0-9_]{1,32}(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text ?? '');
  return m?.[1]?.trim() ?? '';
}

type CompleteDraft = { name: string; phone: string; districtId: string; address: string; payment: PaymentMethod; bkashTrxId?: string };

function completeDraft(d: CheckoutDraft): CompleteDraft | undefined {
  if (!d.name || !d.phone || !d.districtId || !d.address || !d.payment) return undefined;
  if (d.payment === 'bkash' && !d.bkashTrxId) return undefined;
  const out: CompleteDraft = { name: d.name, phone: d.phone, districtId: d.districtId, address: d.address, payment: d.payment };
  if (d.bkashTrxId) out.bkashTrxId = d.bkashTrxId;
  return out;
}
