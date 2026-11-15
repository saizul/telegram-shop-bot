import { unitPrice, type Product } from '../catalog/types.js';
import type { CartItem } from './types.js';

export const MAX_QTY_PER_ITEM = 20;
export const MAX_CART_LINES = 30;

export type CartChange =
  | { ok: true; items: CartItem[]; qty: number }
  | { ok: false; reason: 'out-of-stock' | 'stock-limit' | 'max-qty' | 'cart-full'; limit?: number };

/** Add `delta` units of a product (negative removes). Quantity 0 drops the line. */
export function changeQty(items: readonly CartItem[], product: Product, delta: number): CartChange {
  const current = items.find((i) => i.productId === product.id)?.qty ?? 0;
  const next = current + delta;
  if (delta > 0) {
    if (product.stock === 0) return { ok: false, reason: 'out-of-stock' };
    if (product.stock !== undefined && next > product.stock) return { ok: false, reason: 'stock-limit', limit: product.stock };
    if (next > MAX_QTY_PER_ITEM) return { ok: false, reason: 'max-qty', limit: MAX_QTY_PER_ITEM };
    if (current === 0 && items.length >= MAX_CART_LINES) return { ok: false, reason: 'cart-full', limit: MAX_CART_LINES };
  }
  return { ok: true, items: setQty(items, product.id, next), qty: Math.max(0, next) };
}

/** Set a line's quantity, keeping line order. */
export function setQty(items: readonly CartItem[], productId: string, qty: number): CartItem[] {
  if (qty <= 0) return items.filter((i) => i.productId !== productId);
  if (items.some((i) => i.productId === productId)) {
    return items.map((i) => (i.productId === productId ? { ...i, qty } : i));
  }
  return [...items, { productId, qty }];
}

export interface PricedLine {
  product: Product;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface PricedCart {
  lines: PricedLine[];
  /** Cart lines whose product no longer exists or is inactive. */
  missing: string[];
  /** Lines whose quantity exceeds current stock. */
  overStock: string[];
  subtotal: number;
  count: number;
}

/** Look up current prices and stock for the cart. */
export function priceCart(items: readonly CartItem[], lookup: (id: string) => Product | undefined): PricedCart {
  const lines: PricedLine[] = [];
  const missing: string[] = [];
  const overStock: string[] = [];
  for (const item of items) {
    const product = lookup(item.productId);
    if (!product || !product.active) {
      missing.push(item.productId);
      continue;
    }
    if (product.stock !== undefined && item.qty > product.stock) overStock.push(product.id);
    const price = unitPrice(product);
    lines.push({ product, qty: item.qty, unitPrice: price, total: roundTaka(price * item.qty) });
  }
  return {
    lines,
    missing,
    overStock,
    subtotal: roundTaka(lines.reduce((s, l) => s + l.total, 0)),
    count: lines.reduce((s, l) => s + l.qty, 0),
  };
}

/** Round to 2 decimals to avoid floating point noise (৳0.1 + ৳0.2). */
export function roundTaka(amount: number): number {
  return Math.round(amount * 100) / 100;
}
