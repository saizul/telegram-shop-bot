import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { CartItem, Order, Session } from '../shop/types.js';
import { DuplicateOrderError, type Store } from './types.js';

/** True when this Node.js build has the built-in `node:sqlite` module (22.13+ / 23.4+ unflagged). */
export async function hasNodeSqlite(): Promise<boolean> {
  try {
    await import('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  user_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cart_items (
  user_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  position INTEGER NOT NULL,
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  total REAL NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_user ON orders (user_id, created_at DESC);
`;

/**
 * SQLite store using Node's built-in `node:sqlite` (no native add-on to compile).
 * Use `openSqliteStore()` to create one; it loads the module lazily so the package still
 * imports on Node versions without it.
 */
export class SqliteStore implements Store {
  constructor(private readonly db: DatabaseSync) {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA);
  }

  async getSession(userId: number): Promise<Session | undefined> {
    const row = this.db.prepare('SELECT data FROM sessions WHERE user_id = ?').get(userId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Session) : undefined;
  }

  async saveSession(session: Session): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO sessions (user_id, data, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
      )
      .run(session.userId, JSON.stringify(session), session.updatedAt);
  }

  async getCart(userId: number): Promise<CartItem[]> {
    const rows = this.db
      .prepare('SELECT product_id, qty FROM cart_items WHERE user_id = ? ORDER BY position')
      .all(userId) as Array<{ product_id: string; qty: number }>;
    return rows.map((r) => ({ productId: r.product_id, qty: Number(r.qty) }));
  }

  async setCart(userId: number, items: CartItem[]): Promise<void> {
    const del = this.db.prepare('DELETE FROM cart_items WHERE user_id = ?');
    const ins = this.db.prepare('INSERT INTO cart_items (user_id, product_id, qty, position) VALUES (?, ?, ?, ?)');
    this.db.exec('BEGIN');
    try {
      del.run(userId);
      items.forEach((item, i) => ins.run(userId, item.productId, item.qty, i));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async createOrder(order: Order): Promise<void> {
    try {
      this.db
        .prepare('INSERT INTO orders (id, user_id, status, total, created_at, data) VALUES (?, ?, ?, ?, ?, ?)')
        .run(order.id, order.userId, order.status, order.total, order.createdAt, JSON.stringify(order));
    } catch (err) {
      if (/UNIQUE|PRIMARY KEY/i.test((err as Error).message)) throw new DuplicateOrderError(order.id);
      throw err;
    }
  }

  async getOrder(id: string): Promise<Order | undefined> {
    const row = this.db.prepare('SELECT data FROM orders WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Order) : undefined;
  }

  async saveOrder(order: Order): Promise<void> {
    this.db
      .prepare('UPDATE orders SET status = ?, total = ?, data = ? WHERE id = ?')
      .run(order.status, order.total, JSON.stringify(order), order.id);
  }

  async listOrders(userId: number, limit: number): Promise<Order[]> {
    const rows = this.db
      .prepare('SELECT data FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as Order);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/** Open (or create) a SQLite database file. Use `:memory:` for a throwaway database. */
export async function openSqliteStore(path: string): Promise<SqliteStore> {
  let mod: typeof import('node:sqlite');
  try {
    mod = await import('node:sqlite');
  } catch {
    throw new Error('node:sqlite is not available in this Node.js version. Use STORAGE=json or Node 22.13+.');
  }
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  return new SqliteStore(new mod.DatabaseSync(path));
}
