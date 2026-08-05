/**
 * Cache-Control middleware.
 *
 * Default for /api/v1/* is deny (no-store). New endpoints must never silently
 * inherit a stale window — iOS NSURLCache treats max-age as fresh, so a
 * private max-age on mutation-invalidated GETs leaves React Native serving
 * pre-mutation bodies until app relaunch. Opt in via CACHEABLE_ROUTES only
 * when stale responses are demonstrably safe.
 *
 * - STATIC_ROUTES → 24h public (rarely-changing reference data)
 * - CACHEABLE_ROUTES → 5min private (explicit allow-list only)
 * - Default /api/v1 → no-store
 */
import type { NextFunction, Request, Response } from 'express';

/** Rarely-changing reference data — safe to cache publicly. */
export const STATIC_ROUTES: string[] = [
  // SETUP: e.g. '/api/v1/config', '/api/v1/catalog'
];

/**
 * Explicit allow-list for short private caching. Empty by design — only add a
 * path when serving a stale body for up to 5 minutes is demonstrably safe.
 * If in doubt, leave it out (default no-store wins).
 */
export const CACHEABLE_ROUTES: string[] = [];

function setNoStore(res: Response) {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

export function cacheControl(req: Request, res: Response, next: NextFunction) {
  const path = req.path;

  if (STATIC_ROUTES.some(route => path.startsWith(route))) {
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Vary', 'Accept-Encoding');
  } else if (CACHEABLE_ROUTES.some(route => path.startsWith(route))) {
    res.set('Cache-Control', 'private, max-age=300');
    res.set('Vary', 'Accept-Encoding, Authorization');
  } else if (path.startsWith('/api/v1')) {
    setNoStore(res);
  } else if (path === '/health' || path === '/') {
    res.set('Cache-Control', 'no-cache');
  }

  next();
}
