import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';

/**
 * express-rate-limit's default MemoryStore starts a setInterval at
 * construction, which Workers forbids at module scope. Same semantics, but
 * expired entries are dropped lazily on access. Per-isolate, so limits are
 * best-effort on Workers (ponytail: move to a D1/KV counter if strict limits matter).
 */
export class LazyMemoryStore implements Store {
  localKeys = true;
  private windowMs = 60_000;
  private hits = new Map<string, { count: number; resetTime: Date }>();

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (!entry || entry.resetTime.getTime() <= now) {
      entry = { count: 0, resetTime: new Date(now + this.windowMs) };
      this.hits.set(key, entry);
      // Sweep other expired keys so the map can't grow unbounded.
      for (const [k, v] of this.hits) {
        if (v.resetTime.getTime() <= now) this.hits.delete(k);
      }
    }
    entry.count++;
    return { totalHits: entry.count, resetTime: entry.resetTime };
  }

  async decrement(key: string): Promise<void> {
    const entry = this.hits.get(key);
    if (entry && entry.count > 0) entry.count--;
  }

  async resetKey(key: string): Promise<void> {
    this.hits.delete(key);
  }
}
