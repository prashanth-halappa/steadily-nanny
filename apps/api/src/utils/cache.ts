import type { User } from '@supabase/supabase-js';
import NodeCache from 'node-cache';

/**
 * Shared in-memory cache.
 * - stdTTL: 5 minutes default
 * - checkperiod: 60s cleanup
 * - useClones: false for performance (returns direct references)
 */
export const cache = new NodeCache({
  stdTTL: 300,
  checkperiod: 60,
  useClones: false,
});

/** Cache TTL constants (seconds). */
export const TTL = {
  SHORT: 300, // 5 min
  MEDIUM: 900, // 15 min
  LONG: 3600, // 1 hour
  DAY: 86400, // 24 hours
  RELATIONSHIP: 3600, // 1 hour (ownership relationships are stable)
  RELATIONSHIP_NEGATIVE: 300, // 5 min (negative cache for invalid relationships)
  TOKEN: 900, // 15 min (JWT token cache)
};

/** Cache key generators for consistent formatting. */
export const CacheKeys = {
  /**
   * Cache key for a JWT token.
   *
   * SECURITY: must key on the FULL token. Supabase JWTs from one project share
   * an identical base64 header (same alg + kid), so any prefix collides across
   * every user — serving one user's cached session to another and accepting
   * forged tokens sharing the header prefix (auth bypass). Never log/dump raw
   * `cache.keys()`: they contain live bearer tokens.
   */
  token: (token: string): string => `auth:token:${token}`,

  /** Cache key for a user↔resource ownership relationship. */
  relationship: (userId: string, resourceId: string): string =>
    `auth:rel:${userId}:${resourceId}`,
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

/** Invalidate a single cached JWT auth entry for the given token. */
export const invalidateTokenCache = (token: string): void => {
  cache.del(CacheKeys.token(token));
};

/**
 * Invalidate all cached JWT auth entries for a user. Returns the count removed.
 */
export const invalidateUserTokenCache = (userId: string): number => {
  const tokenPrefix = 'auth:token:';
  const keysToDelete = cache.keys().filter(key => {
    if (!key.startsWith(tokenPrefix)) {
      return false;
    }
    const user = cache.get<User>(key);
    return user?.id === userId;
  });

  if (keysToDelete.length > 0) {
    cache.del(keysToDelete);
  }

  return keysToDelete.length;
};
