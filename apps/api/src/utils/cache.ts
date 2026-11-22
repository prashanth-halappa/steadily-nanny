/**
 * Shared in-memory cache (per isolate on Workers — best-effort, never the
 * source of truth). Same get/set/del/keys surface node-cache had, minus its
 * background sweep timer (timers can't run at module scope on Workers):
 * expiry is checked lazily on read/keys.
 * - default TTL: 5 minutes
 */
class TtlCache {
  private store = new Map<string, { value: unknown; expires: number }>();

  get<T>(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  /** @param ttlSeconds defaults to 300; 0 = never expires (node-cache parity) */
  set<T>(key: string, value: T, ttlSeconds = 300): boolean {
    this.store.set(key, {
      value,
      expires: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : Infinity,
    });
    return true;
  }

  del(keys: string | string[]): number {
    let n = 0;
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      if (this.store.delete(k)) n++;
    }
    return n;
  }

  keys(): string[] {
    const now = Date.now();
    for (const [k, v] of this.store) if (v.expires <= now) this.store.delete(k);
    return [...this.store.keys()];
  }
}

export const cache = new TtlCache();

/** Cache TTL constants (seconds). */
export const TTL = {
  SHORT: 300, // 5 min
  MEDIUM: 900, // 15 min
  LONG: 3600, // 1 hour
  DAY: 86400, // 24 hours
  RELATIONSHIP: 3600, // 1 hour (ownership relationships are stable)
  RELATIONSHIP_NEGATIVE: 300, // 5 min (negative cache for invalid relationships)
};

/** Consistent cache key for user↔resource ownership validation. */
export const getRelationshipKey = (
  userId: string,
  resourceId: string
): string => `auth:relationship:user:${userId}:resource:${resourceId}`;

/**
 * Invalidate all auth-prefixed cache entries associated with a resource. Only
 * clears `auth:` keys (does NOT touch `api:` keys). Crucial when a resource is
 * deleted/updated to prevent stale auth data.
 */
export const invalidateResourceRelationshipCache = (
  resourceId: string
): void => {
  const keysToDelete = cache
    .keys()
    .filter(key => key.startsWith('auth:') && key.includes(resourceId));
  if (keysToDelete.length > 0) {
    cache.del(keysToDelete);
  }
};
