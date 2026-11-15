export interface RateLimitConfig {
  /** Burst size: how many actions a user can do at once. Default 8. */
  capacity: number;
  /** Tokens refilled per second. Default 1. */
  refillPerSecond: number;
  /** Identical text messages allowed within `repeatWindowMs` before a mute. Default 4. */
  maxRepeats: number;
  repeatWindowMs: number;
  /** Rate-limit violations within `strikeWindowMs` before a mute. Default 10. */
  maxStrikes: number;
  strikeWindowMs: number;
  /** Mute duration. Default 10 minutes. */
  muteMs: number;
  /** Longest text message accepted, in characters. Default 1000. */
  maxTextLength: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  capacity: 8,
  refillPerSecond: 1,
  maxRepeats: 4,
  repeatWindowMs: 60_000,
  maxStrikes: 10,
  strikeWindowMs: 60_000,
  muteMs: 10 * 60_000,
  maxTextLength: 1000,
};

export type Verdict =
  | { allowed: true }
  /** `notify` is true only the first time in a row, so the bot does not reply to every spam message. */
  | { allowed: false; reason: 'rate' | 'muted' | 'too-long' | 'repeat'; notify: boolean; retryAfterMs: number };

interface UserState {
  tokens: number;
  last: number;
  strikes: number[];
  mutedUntil: number;
  lastText?: string;
  repeats: number[];
  notified: boolean;
}

/**
 * Per-user token bucket plus simple anti-spam rules (repeated identical messages, overlong
 * messages, persistent flooding leads to a temporary mute). In memory: limits reset on restart,
 * which is fine for a single bot process.
 */
export class RateLimiter {
  private readonly users = new Map<number, UserState>();
  private readonly config: RateLimitConfig;

  constructor(
    config: Partial<RateLimitConfig> = {},
    private readonly now: () => number = Date.now,
  ) {
    this.config = { ...DEFAULT_RATE_LIMIT, ...config };
  }

  private state(userId: number): UserState {
    let s = this.users.get(userId);
    if (!s) {
      s = { tokens: this.config.capacity, last: this.now(), strikes: [], mutedUntil: 0, repeats: [], notified: false };
      this.users.set(userId, s);
    }
    return s;
  }

  private deny(s: UserState, reason: 'rate' | 'muted' | 'too-long' | 'repeat', retryAfterMs: number): Verdict {
    const notify = !s.notified;
    s.notified = true;
    return { allowed: false, reason, notify, retryAfterMs };
  }

  private strike(s: UserState, t: number): void {
    s.strikes = s.strikes.filter((x) => t - x < this.config.strikeWindowMs);
    s.strikes.push(t);
    if (s.strikes.length >= this.config.maxStrikes) this.mute(s, t);
  }

  private mute(s: UserState, t: number): void {
    s.mutedUntil = t + this.config.muteMs;
    s.tokens = this.config.capacity; // a fresh bucket once the mute ends
    s.strikes = [];
    s.repeats = [];
    s.notified = false; // tell the user about the mute once
  }

  /** Check an incoming update. `text` is the message text, if any (not callback data). */
  check(userId: number, text?: string): Verdict {
    const t = this.now();
    const s = this.state(userId);
    if (s.mutedUntil > t) return this.deny(s, 'muted', s.mutedUntil - t);

    // Refill the bucket.
    const elapsed = (t - s.last) / 1000;
    s.tokens = Math.min(this.config.capacity, s.tokens + elapsed * this.config.refillPerSecond);
    s.last = t;

    if (text !== undefined) {
      if ([...text].length > this.config.maxTextLength) {
        this.strike(s, t);
        return this.deny(s, 'too-long', 0);
      }
      const normalised = text.trim().toLowerCase();
      if (normalised && normalised === s.lastText) {
        s.repeats = s.repeats.filter((x) => t - x < this.config.repeatWindowMs);
        s.repeats.push(t);
        if (s.repeats.length >= this.config.maxRepeats) {
          this.mute(s, t);
          return this.deny(s, 'repeat', this.config.muteMs);
        }
      } else {
        s.lastText = normalised;
        s.repeats = [];
      }
    }

    if (s.tokens < 1) {
      this.strike(s, t);
      if (s.mutedUntil > t) return this.deny(s, 'muted', s.mutedUntil - t);
      return this.deny(s, 'rate', Math.ceil(((1 - s.tokens) / this.config.refillPerSecond) * 1000));
    }
    s.tokens -= 1;
    s.notified = false;
    return { allowed: true };
  }

  /** Forget users idle for longer than `idleMs` (call periodically to bound memory). */
  sweep(idleMs = 60 * 60_000): number {
    const t = this.now();
    let removed = 0;
    for (const [id, s] of this.users) {
      if (t - s.last > idleMs && s.mutedUntil < t) {
        this.users.delete(id);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.users.size;
  }
}
