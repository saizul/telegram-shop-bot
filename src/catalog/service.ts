import type { Logger } from '../logger.js';
import type { Catalog, CatalogSource, Category, Product } from './types.js';

export interface CatalogServiceOptions {
  /** How long a loaded catalogue is reused, in ms. Default 5 minutes. */
  ttlMs?: number;
  now?: () => number;
  logger?: Logger;
}

/**
 * Caches the catalogue and refreshes it in the background-safe way: concurrent callers share
 * one load, and if a refresh fails the last good catalogue keeps being served.
 */
export class CatalogService {
  private cache: Catalog | undefined;
  private loading: Promise<Catalog> | undefined;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly source: CatalogSource,
    private readonly options: CatalogServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.now = options.now ?? Date.now;
  }

  async get(): Promise<Catalog> {
    if (this.cache && this.now() - this.cache.loadedAt < this.ttlMs) return this.cache;
    return this.refresh();
  }

  /** Force a reload. */
  refresh(): Promise<Catalog> {
    this.loading ??= this.source
      .load()
      .then((c) => {
        this.cache = { ...c, loadedAt: this.now() };
        this.options.logger?.info('catalog loaded', {
          source: this.source.name,
          categories: c.categories.length,
          products: c.products.length,
        });
        return this.cache;
      })
      .catch((err: unknown) => {
        if (this.cache) {
          this.options.logger?.warn('catalog refresh failed, serving cached copy', { error: String(err) });
          return this.cache;
        }
        throw err;
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }

  /** Categories that have at least one active product. */
  async categories(): Promise<Category[]> {
    const c = await this.get();
    const used = new Set(c.products.filter((p) => p.active).map((p) => p.categoryId));
    return c.categories.filter((cat) => used.has(cat.id));
  }

  async category(id: string): Promise<Category | undefined> {
    return (await this.get()).categories.find((c) => c.id === id);
  }

  async productsIn(categoryId: string): Promise<Product[]> {
    return (await this.get()).products.filter((p) => p.active && p.categoryId === categoryId);
  }

  /** Active product by id. */
  async product(id: string): Promise<Product | undefined> {
    return (await this.get()).products.find((p) => p.id === id && p.active);
  }
}
