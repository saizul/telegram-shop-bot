import { toBanglaDigits } from '../bd/digits.js';

export type Lang = 'en' | 'bn';
export const LANGS: readonly Lang[] = ['en', 'bn'];

/**
 * UI strings. `{name}` placeholders are filled by `t()`. Values inserted into HTML strings must
 * already be escaped by the caller.
 */
const en = {
  'start.welcome':
    '<b>Welcome to {shop}!</b>\n\nBrowse the catalogue, add products to your cart and order with cash on delivery or bKash.',
  'help.text':
    '<b>How to order</b>\n1. Tap <b>Shop</b> and pick a category\n2. Open a product and tap <b>Add to cart</b>\n3. Open the cart and tap <b>Checkout</b>\n\nCommands:\n/shop: browse products\n/search WORD: find a product (or just send its name)\n/cart: your cart\n/orders: your recent orders\n/language: switch language\n/cancel: stop checkout',
  'menu.shop': '🛍 Shop',
  'menu.cart': '🛒 Cart ({count})',
  'menu.orders': '📦 My orders',
  'menu.language': '🌐 বাংলা',
  'menu.help': 'ℹ️ Help',
  'nav.back': '⬅️ Back',
  'nav.prev': '◀️',
  'nav.next': '▶️',
  'nav.categories': '📂 Categories',
  'nav.cart': '🛒 Cart',
  'catalog.categories': '<b>Categories</b>\nPick a category:',
  'catalog.empty': 'The catalogue is empty right now. Please check back later.',
  'catalog.category': '<b>{category}</b>\nPage {page} of {pages}',
  'catalog.categoryEmpty': 'No products in this category yet.',
  'catalog.unavailable': 'Sorry, this product is no longer available.',
  'catalog.error': 'The catalogue could not be loaded. Please try again in a minute.',
  'product.price': 'Price: <b>{price}</b>',
  'product.salePrice': 'Price: <s>{old}</s> <b>{price}</b>',
  'product.stock': 'In stock: {stock}',
  'product.outOfStock': '❌ Out of stock',
  'product.add': '➕ Add to cart',
  'product.inCart': '🛒 In cart: {qty}',
  'cart.added': 'Added to cart: {name}',
  'cart.limit': 'Only {stock} available.',
  'cart.maxQty': 'You can order at most {max} of one product.',
  'cart.empty': 'Your cart is empty.',
  'cart.title': '<b>Your cart</b>',
  'cart.line': '{qty} × {name}: {total}',
  'cart.subtotal': 'Subtotal: <b>{amount}</b>',
  'cart.checkout': '✅ Checkout',
  'cart.clear': '🗑 Clear',
  'cart.cleared': 'Cart cleared.',
  'cart.removed': 'Removed.',
  'checkout.savedProfile':
    '<b>Use your saved details?</b>\n{name}\n{phone}\n{address}, {district}',
  'checkout.useSaved': '✅ Use these',
  'checkout.enterNew': '✏️ Enter new',
  'checkout.askName': 'Please send your <b>full name</b>.',
  'checkout.badName': 'Please send a name of 2 to 60 letters.',
  'checkout.askPhone':
    'Please send your <b>mobile number</b> (for example 01712345678), or tap the button below to share it.',
  'checkout.sharePhone': '📱 Share my number',
  'checkout.badPhone': 'That does not look like a Bangladeshi mobile number. Please send an 11-digit number starting with 01.',
  'checkout.askDivision': 'Choose your <b>division</b>:',
  'checkout.askDistrict': 'Choose your <b>district</b> in {division}:',
  'checkout.badDistrict': 'District not found. Please choose from the buttons or type the district name.',
  'checkout.askAddress': 'Please send your <b>full delivery address</b> (house, road, area, thana).',
  'checkout.badAddress': 'Please send an address of 10 to 300 characters.',
  'checkout.askPayment':
    '<b>Payment method</b>\nDelivery to {district}: {fee}\nTotal: <b>{total}</b>',
  'checkout.cod': '💵 Cash on delivery',
  'checkout.bkash': '📲 bKash',
  'checkout.askBkash':
    'Please <b>Send Money</b> {total} to bKash number <code>{number}</code>, then reply with the <b>Transaction ID</b> (TrxID) from the confirmation SMS.',
  'checkout.badBkash': 'A bKash TrxID has 8 to 12 letters and digits, for example 9C7D6E5F4G. Please check and send it again.',
  'checkout.summary':
    '<b>Please confirm your order</b>\n\n{lines}\n\nSubtotal: {subtotal}\nDelivery ({zone}): {fee}\n<b>Total: {total}</b>\n\n<b>Name:</b> {name}\n<b>Phone:</b> {phone}\n<b>Address:</b> {address}, {district}\n<b>Payment:</b> {payment}',
  'checkout.confirm': '✅ Confirm order',
  'checkout.cancel': '✖️ Cancel',
  'checkout.cancelled': 'Checkout cancelled. Your cart is still saved.',
  'checkout.noCheckout': 'There is no checkout in progress.',
  'checkout.stockChanged': 'Sorry, some items in your cart are no longer available in that quantity. Please review your cart.',
  'checkout.expired': 'This checkout has expired. Please open your cart and start again.',
  'zone.inside': 'inside Dhaka',
  'zone.outside': 'outside Dhaka',
  'zone.free': 'free',
  'payment.cod': 'Cash on delivery',
  'payment.bkash': 'bKash (TrxID {ref})',
  'order.placed':
    '🎉 <b>Thank you! Your order {id} has been placed.</b>\n\nTotal: <b>{total}</b>\nPayment: {payment}\n\nWe will call you on {phone} to confirm. You can check the status with /orders.',
  'order.status.pending': 'Pending',
  'order.status.confirmed': 'Confirmed',
  'order.status.shipped': 'Shipped',
  'order.status.delivered': 'Delivered',
  'order.status.cancelled': 'Cancelled',
  'order.update.confirmed': '✅ Your order {id} has been confirmed and is being prepared.',
  'order.update.shipped': '🚚 Your order {id} has been shipped. Please keep {total} ready if paying cash on delivery.',
  'order.update.delivered': '📦 Your order {id} has been delivered. Thank you for shopping with us!',
  'order.update.cancelled': '❌ Your order {id} has been cancelled. Contact us if you have questions.',
  'orders.none': 'You have no orders yet.',
  'orders.title': '<b>Your recent orders</b>',
  'orders.line': '{id} · {date} · {total} · {status}',
  'lang.changed': 'Language set to English.',
  'rate.slowDown': 'Too many requests. Please slow down.',
  'rate.muted': 'You are sending messages too fast. Please wait {minutes} minutes.',
  'error.generic': 'Something went wrong. Please try again.',
  'unknown.text': 'Tap /shop to browse products or /help for help.',
  'search.results': '<b>Results for “{query}”</b>\n{count} product(s) found. Tap one to open it.',
  'search.more': 'Showing the first {shown}. Add another word to narrow the search.',
  'search.none': 'No products match <b>{query}</b>.\nTap /shop to browse products or /help for help.',
  'search.usage': 'Send a product name to search, for example <code>/search jamdani</code>, or just send <code>jamdani</code>.',
  'admin.only': 'Only shop admins can do this.',
  'admin.updated': 'Order {id}: {status}',
  'admin.badTransition': 'Order {id} is already {status}.',
  'admin.notFound': 'Order not found.',
} as const;

export type StringKey = keyof typeof en;

const bn: Record<StringKey, string> = {
  'start.welcome':
    '<b>{shop}-এ স্বাগতম!</b>\n\nপণ্য দেখুন, কার্টে যোগ করুন এবং ক্যাশ অন ডেলিভারি বা বিকাশে অর্ডার করুন।',
  'help.text':
    '<b>কীভাবে অর্ডার করবেন</b>\n১. <b>শপ</b> চাপুন এবং একটি ক্যাটাগরি বেছে নিন\n২. পণ্য খুলে <b>কার্টে যোগ করুন</b> চাপুন\n৩. কার্ট খুলে <b>চেকআউট</b> চাপুন\n\nকমান্ড:\n/shop: পণ্য দেখুন\n/search শব্দ: পণ্য খুঁজুন (অথবা শুধু পণ্যের নাম পাঠান)\n/cart: আপনার কার্ট\n/orders: সাম্প্রতিক অর্ডার\n/language: ভাষা পরিবর্তন\n/cancel: চেকআউট বাতিল',
  'menu.shop': '🛍 শপ',
  'menu.cart': '🛒 কার্ট ({count})',
  'menu.orders': '📦 আমার অর্ডার',
  'menu.language': '🌐 English',
  'menu.help': 'ℹ️ সাহায্য',
  'nav.back': '⬅️ পেছনে',
  'nav.prev': '◀️',
  'nav.next': '▶️',
  'nav.categories': '📂 ক্যাটাগরি',
  'nav.cart': '🛒 কার্ট',
  'catalog.categories': '<b>ক্যাটাগরি</b>\nএকটি ক্যাটাগরি বেছে নিন:',
  'catalog.empty': 'এই মুহূর্তে কোনো পণ্য নেই। পরে আবার দেখুন।',
  'catalog.category': '<b>{category}</b>\nপৃষ্ঠা {page} / {pages}',
  'catalog.categoryEmpty': 'এই ক্যাটাগরিতে এখনো কোনো পণ্য নেই।',
  'catalog.unavailable': 'দুঃখিত, এই পণ্যটি আর পাওয়া যাচ্ছে না।',
  'catalog.error': 'পণ্যের তালিকা লোড করা যায়নি। এক মিনিট পরে আবার চেষ্টা করুন।',
  'product.price': 'দাম: <b>{price}</b>',
  'product.salePrice': 'দাম: <s>{old}</s> <b>{price}</b>',
  'product.stock': 'স্টকে আছে: {stock}',
  'product.outOfStock': '❌ স্টক শেষ',
  'product.add': '➕ কার্টে যোগ করুন',
  'product.inCart': '🛒 কার্টে: {qty}',
  'cart.added': 'কার্টে যোগ হয়েছে: {name}',
  'cart.limit': 'মাত্র {stock}টি আছে।',
  'cart.maxQty': 'একটি পণ্য সর্বোচ্চ {max}টি অর্ডার করা যাবে।',
  'cart.empty': 'আপনার কার্ট খালি।',
  'cart.title': '<b>আপনার কার্ট</b>',
  'cart.line': '{qty} × {name}: {total}',
  'cart.subtotal': 'মোট পণ্যমূল্য: <b>{amount}</b>',
  'cart.checkout': '✅ চেকআউট',
  'cart.clear': '🗑 খালি করুন',
  'cart.cleared': 'কার্ট খালি করা হয়েছে।',
  'cart.removed': 'সরানো হয়েছে।',
  'checkout.savedProfile': '<b>আগের তথ্য ব্যবহার করবেন?</b>\n{name}\n{phone}\n{address}, {district}',
  'checkout.useSaved': '✅ এগুলোই',
  'checkout.enterNew': '✏️ নতুন তথ্য দিন',
  'checkout.askName': 'আপনার <b>পূর্ণ নাম</b> লিখুন।',
  'checkout.badName': 'অনুগ্রহ করে ২ থেকে ৬০ অক্ষরের একটি নাম লিখুন।',
  'checkout.askPhone': 'আপনার <b>মোবাইল নম্বর</b> লিখুন (যেমন ০১৭১২৩৪৫৬৭৮), অথবা নিচের বাটন চেপে নম্বর শেয়ার করুন।',
  'checkout.sharePhone': '📱 আমার নম্বর শেয়ার করুন',
  'checkout.badPhone': 'এটি সঠিক বাংলাদেশি মোবাইল নম্বর মনে হচ্ছে না। ০১ দিয়ে শুরু ১১ সংখ্যার নম্বর লিখুন।',
  'checkout.askDivision': 'আপনার <b>বিভাগ</b> বেছে নিন:',
  'checkout.askDistrict': '{division} বিভাগে আপনার <b>জেলা</b> বেছে নিন:',
  'checkout.badDistrict': 'জেলা পাওয়া যায়নি। বাটন থেকে বেছে নিন অথবা জেলার নাম লিখুন।',
  'checkout.askAddress': 'আপনার <b>সম্পূর্ণ ডেলিভারি ঠিকানা</b> লিখুন (বাসা, রোড, এলাকা, থানা)।',
  'checkout.badAddress': 'অনুগ্রহ করে ১০ থেকে ৩০০ অক্ষরের মধ্যে ঠিকানা লিখুন।',
  'checkout.askPayment': '<b>পেমেন্ট পদ্ধতি</b>\n{district}-এ ডেলিভারি চার্জ: {fee}\nসর্বমোট: <b>{total}</b>',
  'checkout.cod': '💵 ক্যাশ অন ডেলিভারি',
  'checkout.bkash': '📲 বিকাশ',
  'checkout.askBkash':
    'বিকাশ নম্বর <code>{number}</code>-এ {total} <b>সেন্ড মানি</b> করুন, তারপর কনফার্মেশন SMS থেকে <b>ট্রানজেকশন আইডি</b> (TrxID) লিখে পাঠান।',
  'checkout.badBkash': 'বিকাশ TrxID-তে ৮ থেকে ১২টি অক্ষর ও সংখ্যা থাকে, যেমন 9C7D6E5F4G। আবার দেখে পাঠান।',
  'checkout.summary':
    '<b>অর্ডারটি নিশ্চিত করুন</b>\n\n{lines}\n\nপণ্যমূল্য: {subtotal}\nডেলিভারি ({zone}): {fee}\n<b>সর্বমোট: {total}</b>\n\n<b>নাম:</b> {name}\n<b>ফোন:</b> {phone}\n<b>ঠিকানা:</b> {address}, {district}\n<b>পেমেন্ট:</b> {payment}',
  'checkout.confirm': '✅ অর্ডার নিশ্চিত করুন',
  'checkout.cancel': '✖️ বাতিল',
  'checkout.cancelled': 'চেকআউট বাতিল হয়েছে। আপনার কার্ট সংরক্ষিত আছে।',
  'checkout.noCheckout': 'কোনো চেকআউট চলছে না।',
  'checkout.stockChanged': 'দুঃখিত, কার্টের কিছু পণ্য এই পরিমাণে আর নেই। কার্টটি আবার দেখুন।',
  'checkout.expired': 'এই চেকআউটের মেয়াদ শেষ। কার্ট খুলে আবার শুরু করুন।',
  'zone.inside': 'ঢাকার ভেতরে',
  'zone.outside': 'ঢাকার বাইরে',
  'zone.free': 'ফ্রি',
  'payment.cod': 'ক্যাশ অন ডেলিভারি',
  'payment.bkash': 'বিকাশ (TrxID {ref})',
  'order.placed':
    '🎉 <b>ধন্যবাদ! আপনার অর্ডার {id} গ্রহণ করা হয়েছে।</b>\n\nসর্বমোট: <b>{total}</b>\nপেমেন্ট: {payment}\n\nনিশ্চিত করতে আমরা {phone} নম্বরে কল করব। /orders দিয়ে অর্ডারের অবস্থা দেখতে পারবেন।',
  'order.status.pending': 'অপেক্ষমাণ',
  'order.status.confirmed': 'নিশ্চিত',
  'order.status.shipped': 'পাঠানো হয়েছে',
  'order.status.delivered': 'ডেলিভারি সম্পন্ন',
  'order.status.cancelled': 'বাতিল',
  'order.update.confirmed': '✅ আপনার অর্ডার {id} নিশ্চিত হয়েছে এবং প্রস্তুত করা হচ্ছে।',
  'order.update.shipped': '🚚 আপনার অর্ডার {id} পাঠানো হয়েছে। ক্যাশ অন ডেলিভারি হলে {total} প্রস্তুত রাখুন।',
  'order.update.delivered': '📦 আপনার অর্ডার {id} ডেলিভারি হয়েছে। আমাদের সাথে কেনাকাটার জন্য ধন্যবাদ!',
  'order.update.cancelled': '❌ আপনার অর্ডার {id} বাতিল করা হয়েছে। কোনো প্রশ্ন থাকলে যোগাযোগ করুন।',
  'orders.none': 'আপনার কোনো অর্ডার নেই।',
  'orders.title': '<b>আপনার সাম্প্রতিক অর্ডার</b>',
  'orders.line': '{id} · {date} · {total} · {status}',
  'lang.changed': 'ভাষা বাংলা করা হয়েছে।',
  'rate.slowDown': 'অনেক বেশি অনুরোধ। একটু ধীরে চেষ্টা করুন।',
  'rate.muted': 'আপনি খুব দ্রুত মেসেজ পাঠাচ্ছেন। {minutes} মিনিট অপেক্ষা করুন।',
  'error.generic': 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।',
  'unknown.text': 'পণ্য দেখতে /shop অথবা সাহায্যের জন্য /help চাপুন।',
  'search.results': '<b>“{query}” এর ফলাফল</b>\n{count}টি পণ্য পাওয়া গেছে। খুলতে একটিতে চাপুন।',
  'search.more': 'প্রথম {shown}টি দেখানো হচ্ছে। আরও একটি শব্দ যোগ করে খোঁজ ছোট করুন।',
  'search.none': '<b>{query}</b> নামে কোনো পণ্য পাওয়া যায়নি।\nপণ্য দেখতে /shop অথবা সাহায্যের জন্য /help চাপুন।',
  'search.usage': 'খুঁজতে পণ্যের নাম পাঠান, যেমন <code>/search জামদানি</code>, অথবা শুধু <code>জামদানি</code> লিখে পাঠান।',
  'admin.only': 'শুধু শপ অ্যাডমিন এটি করতে পারবেন।',
  'admin.updated': 'অর্ডার {id}: {status}',
  'admin.badTransition': 'অর্ডার {id} ইতিমধ্যে {status}।',
  'admin.notFound': 'অর্ডার পাওয়া যায়নি।',
};

const STRINGS: Record<Lang, Record<StringKey, string>> = { en, bn };

export type Params = Record<string, string | number>;

/**
 * Translate a key. Numbers in params are shown with Bangla digits in Bangla.
 * Unknown placeholders are left as they are so missing params are easy to spot.
 */
export function t(lang: Lang, key: StringKey, params: Params = {}): string {
  const template = STRINGS[lang][key] ?? STRINGS.en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === 'number' && lang === 'bn' ? toBanglaDigits(String(value)) : String(value);
  });
}

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'bn';
}

/** Every key, for completeness tests. */
export function allKeys(lang: Lang): string[] {
  return Object.keys(STRINGS[lang]);
}

/** Bot command descriptions for setMyCommands, per language. */
export const COMMANDS: Record<Lang, Array<{ command: string; description: string }>> = {
  en: [
    { command: 'shop', description: 'Browse products' },
    { command: 'search', description: 'Find a product' },
    { command: 'cart', description: 'Your cart' },
    { command: 'orders', description: 'Your recent orders' },
    { command: 'language', description: 'বাংলা / English' },
    { command: 'help', description: 'How to order' },
    { command: 'cancel', description: 'Cancel checkout' },
  ],
  bn: [
    { command: 'shop', description: 'পণ্য দেখুন' },
    { command: 'search', description: 'পণ্য খুঁজুন' },
    { command: 'cart', description: 'আপনার কার্ট' },
    { command: 'orders', description: 'সাম্প্রতিক অর্ডার' },
    { command: 'language', description: 'বাংলা / English' },
    { command: 'help', description: 'কীভাবে অর্ডার করবেন' },
    { command: 'cancel', description: 'চেকআউট বাতিল' },
  ],
};
