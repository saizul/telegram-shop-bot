import { DIVISIONS, districtsOf, getDistrict, getDivision } from '../bd/districts.js';
import { toBanglaDigits } from '../bd/digits.js';
import { formatTaka } from '../bd/money.js';
import { localized, unitPrice, type Category, type Product } from '../catalog/types.js';
import { t, type Lang } from '../i18n/strings.js';
import { button, chunk, escapeHtml, inlineKeyboard, truncate } from '../telegram/format.js';
import { LIMITS, type InlineKeyboardButton, type InlineKeyboardMarkup } from '../telegram/types.js';
import type { PricedCart } from '../shop/cart.js';
import { nextActions, type OrderAction } from '../shop/orders.js';
import type { CheckoutDraft, CustomerProfile, DeliveryZone, Order, OrderStatus, PaymentMethod } from '../shop/types.js';

/** What to show: a text message, or a photo with caption. */
export interface Screen {
  text: string;
  keyboard?: InlineKeyboardMarkup;
  photo?: string;
}

export const PRODUCTS_PER_PAGE = 6;

/** Callback data scheme. Kept short; every value stays well under 64 bytes. */
export const CB = {
  menu: 'm',
  shop: 'c',
  category: (id: string, page = 0) => `c:${id}:${page}`,
  product: (id: string) => `p:${id}`,
  add: (id: string) => `a:${id}`,
  remove: (id: string) => `r:${id}`,
  cart: 'cart',
  cartInc: (id: string) => `ci:${id}`,
  cartDec: (id: string) => `cd:${id}`,
  cartDel: (id: string) => `cr:${id}`,
  cartClear: 'cc',
  checkout: 'co',
  useProfile: 'cp:use',
  newProfile: 'cp:new',
  division: (id: string) => `dv:${id}`,
  divisions: 'dvb',
  district: (id: string) => `dd:${id}`,
  pay: (m: PaymentMethod) => `pm:${m}`,
  confirm: 'ok',
  cancel: 'x',
  orders: 'mo',
  help: 'mh',
  lang: (l: Lang) => `l:${l}`,
  admin: (orderId: string, action: OrderAction) => `o:${orderId}:${action}`,
  noop: 'noop',
} as const;

const money = (amount: number, lang: Lang) => formatTaka(amount, lang);

export function mainMenu(lang: Lang, shopName: string, cartCount: number): Screen {
  return {
    text: t(lang, 'start.welcome', { shop: escapeHtml(shopName) }),
    keyboard: menuKeyboard(lang, cartCount),
  };
}

export function menuKeyboard(lang: Lang, cartCount: number): InlineKeyboardMarkup {
  return inlineKeyboard([
    [button(t(lang, 'menu.shop'), CB.shop), button(t(lang, 'menu.cart', { count: cartCount }), CB.cart)],
    [button(t(lang, 'menu.orders'), CB.orders), button(t(lang, 'menu.language'), CB.lang(lang === 'bn' ? 'en' : 'bn'))],
    [button(t(lang, 'menu.help'), CB.help)],
  ]);
}

export function helpScreen(lang: Lang): Screen {
  return { text: t(lang, 'help.text'), keyboard: inlineKeyboard([[button(t(lang, 'nav.back'), CB.menu)]]) };
}

export function categoriesScreen(lang: Lang, categories: Category[]): Screen {
  if (categories.length === 0) {
    return { text: t(lang, 'catalog.empty'), keyboard: inlineKeyboard([[button(t(lang, 'nav.back'), CB.menu)]]) };
  }
  const buttons = categories.map((c) => button(localized(c.name, lang), CB.category(c.id)));
  return {
    text: t(lang, 'catalog.categories'),
    keyboard: inlineKeyboard([...chunk(buttons, 2), [button(t(lang, 'nav.back'), CB.menu)]]),
  };
}

export function categoryScreen(lang: Lang, category: Category, products: Product[], page: number): Screen {
  const pages = Math.max(1, Math.ceil(products.length / PRODUCTS_PER_PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = products.slice(p * PRODUCTS_PER_PAGE, (p + 1) * PRODUCTS_PER_PAGE);
  const rows: InlineKeyboardButton[][] = slice.map((prod) => [
    button(`${localized(prod.name, lang)} · ${money(unitPrice(prod), lang)}${prod.stock === 0 ? ' ✖' : ''}`, CB.product(prod.id)),
  ]);
  const nav: InlineKeyboardButton[] = [];
  if (p > 0) nav.push(button(t(lang, 'nav.prev'), CB.category(category.id, p - 1)));
  if (p < pages - 1) nav.push(button(t(lang, 'nav.next'), CB.category(category.id, p + 1)));
  rows.push(nav, [button(t(lang, 'nav.categories'), CB.shop), button(t(lang, 'nav.cart'), CB.cart)]);
  const text =
    products.length === 0
      ? `<b>${escapeHtml(localized(category.name, lang))}</b>\n${t(lang, 'catalog.categoryEmpty')}`
      : t(lang, 'catalog.category', { category: escapeHtml(localized(category.name, lang)), page: p + 1, pages });
  return { text, keyboard: inlineKeyboard(rows) };
}

/** Search results shown at most; the customer is asked to add a word when there are more. */
export const SEARCH_RESULTS_SHOWN = 10;

export function searchScreen(lang: Lang, query: string, products: Product[]): Screen {
  const shown = products.slice(0, SEARCH_RESULTS_SHOWN);
  const safeQuery = escapeHtml(truncate(query.trim(), 40));
  const rows: InlineKeyboardButton[][] = shown.map((prod) => [
    button(`${localized(prod.name, lang)} · ${money(unitPrice(prod), lang)}${prod.stock === 0 ? ' ✖' : ''}`, CB.product(prod.id)),
  ]);
  rows.push([button(t(lang, 'nav.categories'), CB.shop), button(t(lang, 'nav.cart'), CB.cart)]);
  if (products.length === 0) {
    return { text: t(lang, 'search.none', { query: safeQuery }), keyboard: inlineKeyboard(rows) };
  }
  let text = t(lang, 'search.results', { query: safeQuery, count: products.length });
  if (products.length > shown.length) text += `\n${t(lang, 'search.more', { shown: shown.length })}`;
  return { text, keyboard: inlineKeyboard(rows) };
}

export function productCaption(lang: Lang, product: Product): string {
  const name = `<b>${escapeHtml(localized(product.name, lang))}</b>`;
  const price =
    product.salePrice !== undefined && product.salePrice < product.price
      ? t(lang, 'product.salePrice', { old: money(product.price, lang), price: money(product.salePrice, lang) })
      : t(lang, 'product.price', { price: money(product.price, lang) });
  const stock =
    product.stock === undefined ? '' : product.stock === 0 ? t(lang, 'product.outOfStock') : t(lang, 'product.stock', { stock: product.stock });
  const head = [name, price, stock].filter(Boolean).join('\n');
  const description = localized(product.description, lang);
  // Leave room for the head so the caption never exceeds Telegram's limit.
  const room = LIMITS.caption - [...head].length - 2;
  return description && room > 20 ? `${head}\n\n${escapeHtml(truncate(description, room))}` : head;
}

export function productKeyboard(lang: Lang, product: Product, inCart: number): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  if (product.stock !== 0) {
    rows.push(
      inCart > 0
        ? [
            button('➖', CB.remove(product.id)),
            button(t(lang, 'product.inCart', { qty: inCart }), CB.cart),
            button('➕', CB.add(product.id)),
          ]
        : [button(t(lang, 'product.add'), CB.add(product.id))],
    );
  }
  rows.push([button(t(lang, 'nav.back'), CB.category(product.categoryId)), button(t(lang, 'nav.cart'), CB.cart)]);
  return inlineKeyboard(rows);
}

export function productScreen(lang: Lang, product: Product, inCart: number): Screen {
  const screen: Screen = { text: productCaption(lang, product), keyboard: productKeyboard(lang, product, inCart) };
  if (product.photo) screen.photo = product.photo;
  return screen;
}

export function cartScreen(lang: Lang, cart: PricedCart): Screen {
  if (cart.lines.length === 0) {
    return {
      text: t(lang, 'cart.empty'),
      keyboard: inlineKeyboard([[button(t(lang, 'menu.shop'), CB.shop)], [button(t(lang, 'nav.back'), CB.menu)]]),
    };
  }
  const lines = cart.lines.map((l) =>
    t(lang, 'cart.line', { qty: l.qty, name: escapeHtml(localized(l.product.name, lang)), total: money(l.total, lang) }),
  );
  const rows: InlineKeyboardButton[][] = cart.lines.map((l) => [
    button('➖', CB.cartDec(l.product.id)),
    button(`${truncate(localized(l.product.name, lang), 18)} × ${lang === 'bn' ? toBanglaDigits(String(l.qty)) : l.qty}`, CB.product(l.product.id)),
    button('➕', CB.cartInc(l.product.id)),
    button('✖', CB.cartDel(l.product.id)),
  ]);
  rows.push([button(t(lang, 'cart.clear'), CB.cartClear), button(t(lang, 'cart.checkout'), CB.checkout)]);
  rows.push([button(t(lang, 'menu.shop'), CB.shop)]);
  return {
    text: `${t(lang, 'cart.title')}\n\n${lines.join('\n')}\n\n${t(lang, 'cart.subtotal', { amount: money(cart.subtotal, lang) })}`,
    keyboard: inlineKeyboard(rows),
  };
}

export function savedProfileScreen(lang: Lang, profile: CustomerProfile): Screen {
  const district = getDistrict(profile.districtId);
  return {
    text: t(lang, 'checkout.savedProfile', {
      name: escapeHtml(profile.name),
      phone: profile.phone,
      address: escapeHtml(profile.address),
      district: district ? district[lang] : profile.districtId,
    }),
    keyboard: inlineKeyboard([
      [button(t(lang, 'checkout.useSaved'), CB.useProfile), button(t(lang, 'checkout.enterNew'), CB.newProfile)],
      [button(t(lang, 'checkout.cancel'), CB.cancel)],
    ]),
  };
}

export function divisionsScreen(lang: Lang): Screen {
  const buttons = DIVISIONS.map((d) => button(d[lang], CB.division(d.id)));
  return {
    text: t(lang, 'checkout.askDivision'),
    keyboard: inlineKeyboard([...chunk(buttons, 2), [button(t(lang, 'checkout.cancel'), CB.cancel)]]),
  };
}

export function districtsScreen(lang: Lang, divisionId: string): Screen {
  const division = getDivision(divisionId);
  if (!division) return divisionsScreen(lang);
  const buttons = districtsOf(divisionId).map((d) => button(d[lang], CB.district(d.id)));
  return {
    text: t(lang, 'checkout.askDistrict', { division: division[lang] }),
    keyboard: inlineKeyboard([...chunk(buttons, 3), [button(t(lang, 'nav.back'), CB.divisions), button(t(lang, 'checkout.cancel'), CB.cancel)]]),
  };
}

export function zoneLabel(lang: Lang, zone: DeliveryZone): string {
  return t(lang, zone === 'inside' ? 'zone.inside' : 'zone.outside');
}

export function feeLabel(lang: Lang, fee: number): string {
  return fee === 0 ? t(lang, 'zone.free') : money(fee, lang);
}

export function paymentScreen(lang: Lang, districtName: string, fee: number, total: number, bkashEnabled: boolean): Screen {
  const methods = [button(t(lang, 'checkout.cod'), CB.pay('cod'))];
  if (bkashEnabled) methods.push(button(t(lang, 'checkout.bkash'), CB.pay('bkash')));
  return {
    text: t(lang, 'checkout.askPayment', { district: districtName, fee: feeLabel(lang, fee), total: money(total, lang) }),
    keyboard: inlineKeyboard([methods, [button(t(lang, 'checkout.cancel'), CB.cancel)]]),
  };
}

export function bkashScreen(lang: Lang, number: string, total: number): Screen {
  return {
    text: t(lang, 'checkout.askBkash', { number, total: money(total, lang) }),
    keyboard: inlineKeyboard([[button(t(lang, 'checkout.cancel'), CB.cancel)]]),
  };
}

export function paymentLabel(lang: Lang, method: PaymentMethod, trxId?: string): string {
  return method === 'bkash' ? t(lang, 'payment.bkash', { ref: escapeHtml(trxId ?? '') }) : t(lang, 'payment.cod');
}

export function summaryScreen(
  lang: Lang,
  cart: PricedCart,
  draft: Required<Pick<CheckoutDraft, 'name' | 'phone' | 'districtId' | 'address' | 'payment'>> & Pick<CheckoutDraft, 'bkashTrxId'>,
  fee: { zone: DeliveryZone; fee: number },
): Screen {
  const lines = cart.lines
    .map((l) => t(lang, 'cart.line', { qty: l.qty, name: escapeHtml(localized(l.product.name, lang)), total: money(l.total, lang) }))
    .join('\n');
  const district = getDistrict(draft.districtId);
  return {
    text: t(lang, 'checkout.summary', {
      lines,
      subtotal: money(cart.subtotal, lang),
      zone: zoneLabel(lang, fee.zone),
      fee: feeLabel(lang, fee.fee),
      total: money(cart.subtotal + fee.fee, lang),
      name: escapeHtml(draft.name),
      phone: draft.phone,
      address: escapeHtml(draft.address),
      district: district ? district[lang] : draft.districtId,
      payment: paymentLabel(lang, draft.payment, draft.bkashTrxId),
    }),
    keyboard: inlineKeyboard([[button(t(lang, 'checkout.confirm'), CB.confirm)], [button(t(lang, 'checkout.cancel'), CB.cancel)]]),
  };
}

export function statusLabel(lang: Lang, status: OrderStatus): string {
  return t(lang, `order.status.${status}`);
}

export function ordersScreen(lang: Lang, orders: Order[]): Screen {
  const back = inlineKeyboard([[button(t(lang, 'nav.back'), CB.menu)]]);
  if (orders.length === 0) return { text: t(lang, 'orders.none'), keyboard: back };
  const lines = orders.map((o) =>
    t(lang, 'orders.line', {
      id: o.id,
      date: lang === 'bn' ? toBanglaDigits(o.createdAt.slice(0, 10)) : o.createdAt.slice(0, 10),
      total: money(o.total, lang),
      status: statusLabel(lang, o.status),
    }),
  );
  return { text: `${t(lang, 'orders.title')}\n\n${lines.join('\n')}`, keyboard: back };
}

const ACTION_LABELS: Record<OrderAction, string> = {
  confirm: '✅ Confirm',
  ship: '🚚 Ship',
  deliver: '📦 Delivered',
  cancel: '❌ Cancel',
};

/** Admin group notification. Always English with Bangla product names kept as entered. */
export function adminOrderScreen(order: Order): Screen {
  const who = order.username ? `@${escapeHtml(order.username)}` : `<a href="tg://user?id=${order.userId}">user ${order.userId}</a>`;
  const lines = order.lines.map((l) => `• ${l.qty} × ${escapeHtml(l.name)} = ${formatTaka(l.total)}`).join('\n');
  const payment = order.payment.method === 'bkash' ? `bKash, TrxID <code>${escapeHtml(order.payment.bkashTrxId ?? '')}</code>` : 'Cash on delivery';
  const text = [
    `🧾 <b>Order ${order.id}</b>: <b>${statusLabel('en', order.status).toUpperCase()}</b>`,
    '',
    lines,
    '',
    `Subtotal: ${formatTaka(order.subtotal)}`,
    `Delivery (${order.zone === 'inside' ? 'inside Dhaka' : 'outside Dhaka'}): ${formatTaka(order.deliveryFee)}`,
    `<b>Total: ${formatTaka(order.total)}</b>`,
    `Payment: ${payment}`,
    '',
    `👤 ${escapeHtml(order.customer.name)}`,
    `📞 <code>${order.customer.phone}</code>`,
    `📍 ${escapeHtml(order.customer.address)}, ${escapeHtml(order.customer.district)}`,
    `💬 ${who}`,
    `🕒 ${order.createdAt}`,
  ].join('\n');
  const actions = nextActions(order.status).map((a) => button(ACTION_LABELS[a], CB.admin(order.id, a)));
  const screen: Screen = { text: truncate(text, LIMITS.messageText) };
  if (actions.length) screen.keyboard = inlineKeyboard(chunk(actions, 2));
  return screen;
}
