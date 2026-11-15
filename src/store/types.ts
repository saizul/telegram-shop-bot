import type { CartItem, Order, Session } from '../shop/types.js';

/**
 * Persistence for sessions, carts and orders. Async so other databases can be plugged in;
 * the bundled SQLite and JSON stores are synchronous underneath.
 */
export interface Store {
  getSession(userId: number): Promise<Session | undefined>;
  saveSession(session: Session): Promise<void>;
  getCart(userId: number): Promise<CartItem[]>;
  setCart(userId: number, items: CartItem[]): Promise<void>;
  createOrder(order: Order): Promise<void>;
  getOrder(id: string): Promise<Order | undefined>;
  saveOrder(order: Order): Promise<void>;
  listOrders(userId: number, limit: number): Promise<Order[]>;
  close(): Promise<void>;
}

export class DuplicateOrderError extends Error {
  constructor(id: string) {
    super(`Order ${id} already exists`);
    this.name = 'DuplicateOrderError';
  }
}
