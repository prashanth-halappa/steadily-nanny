/**
 * Cache-Control middleware.
 *
 * Sets Cache-Control headers by route pattern:
 * - Static reference data → 24h public
 * - User-specific/dynamic data → no-store
 * - Default /api/v1 → 5min private (Vary on Authorization so shared URLs are not
 *   served across users)
 *
 * SETUP: adjust STATIC_ROUTES / NO_CACHE_ROUTES for your endpoints.
 */
import type { NextFunction, Request, Response } from 'express';

/** Rarely-changing reference data — safe to cache publicly. */
const STATIC_ROUTES: string[] = [
  // SETUP: e.g. '/api/v1/config', '/api/v1/catalog'
];

/** Real-time / per-user data — never cache. */
const NO_CACHE_ROUTES: string[] = [
  '/api/v1/users', // per-user profile
  '/api/v1/notifications', // real-time
];

export function cacheControl(req: Request, res: Response, next: NextFunction) {
  const path = req.path;

  if (STATIC_ROUTES.some(route => path.startsWith(route))) {
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Vary', 'Accept-Encoding');
  } else if (NO_CACHE_ROUTES.some(route => path.startsWith(route))) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  } else if (path.startsWith('/api/v1')) {
    // Default per-user data: short private cache, keyed on Authorization.
    res.set('Cache-Control', 'private, max-age=300');
    res.set('Vary', 'Accept-Encoding, Authorization');
  } else if (path === '/health' || path === '/') {
    res.set('Cache-Control', 'no-cache');
  }

  next();
}
