import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CartItem, Order, Session } from '../shop/types.js';
import { DuplicateOrderError, type Store } from './types.js';

interface JsonData {
  version: 1;
  sessions: Record<string, Session>;
  carts: Record<string, CartItem[]>;
  orders: Record<string, Order>;
}

const empty = (): JsonData => ({ version: 1, sessions: {}, carts: {}, orders: {} });

/**
 * A single JSON file, rewritten atomically (temp file + rename) after each change.
 * Good for small shops and development. Pass no path for an in-memory store (tests).
 */
export class JsonStore implements Store {
  private data: JsonData;

  constructor(private readonly path?: string) {
    if (path && existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<JsonData>;
      this.data = { ...empty(), ...parsed, version: 1 };
    } else {
      this.data = empty();
    }
  }

  private persist(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  async getSession(userId: number): Promise<Session | undefined> {
    const s = this.data.sessions[userId];
    return s ? structuredClone(s) : undefined;
  }

  async saveSession(session: Session): Promise<void> {
    this.data.sessions[session.userId] = structuredClone(session);
    this.persist();
  }

  async getCart(userId: number): Promise<CartItem[]> {
    return structuredClone(this.data.carts[userId] ?? []);
  }

  async setCart(userId: number, items: CartItem[]): Promise<void> {
    if (items.length === 0) delete this.data.carts[userId];
    else this.data.carts[userId] = structuredClone(items);
    this.persist();
  }

  async createOrder(order: Order): Promise<void> {
    if (this.data.orders[order.id]) throw new DuplicateOrderError(order.id);
    this.data.orders[order.id] = structuredClone(order);
    this.persist();
  }

  async getOrder(id: string): Promise<Order | undefined> {
    const o = this.data.orders[id];
    return o ? structuredClone(o) : undefined;
  }

  async saveOrder(order: Order): Promise<void> {
    this.data.orders[order.id] = structuredClone(order);
    this.persist();
  }

  async listOrders(userId: number, limit: number): Promise<Order[]> {
    return Object.values(this.data.orders)
      .filter((o) => o.userId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, limit)
      .map((o) => structuredClone(o));
  }

  async close(): Promise<void> {
    this.persist();
  }
}
