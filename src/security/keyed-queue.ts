/**
 * Runs tasks one at a time per key (per user), so two quick button presses cannot race on the
 * same cart or checkout. Different users still run in parallel.
 */
export class KeyedQueue {
  private readonly tails = new Map<string | number, Promise<unknown>>();

  run<T>(key: string | number, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }

  get pending(): number {
    return this.tails.size;
  }
}

/** Remembers recently seen ids (update_id) to drop duplicates when Telegram retries a webhook. */
export class RecentIds {
  private readonly seen = new Set<number>();
  private readonly order: number[] = [];

  constructor(private readonly capacity = 1000) {}

  /** Returns true if the id is new (and records it). */
  add(id: number): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.order.push(id);
    if (this.order.length > this.capacity) this.seen.delete(this.order.shift()!);
    return true;
  }
}
