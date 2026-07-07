/**
 * App status route. Mounted at `/api/app` BEFORE the Supabase auth layer, so it
 * is reachable anonymously. If a valid Bearer token is present, `betaAllPro`
 * reflects any per-user override (the token is resolved optionally, reusing the
 * same cache the auth middleware populates).
 *
 * @module routes/appStatusRoutes
 */
import type { User } from '@supabase/supabase-js';
import { type Request, type Response, Router } from 'express';
import { supabase } from '../config/supabase';
import { getAppStatus } from '../domains/app/services/appStatusService';
import { extractBearerToken } from '../middlewares/auth';
import { CacheKeys, cache, TTL } from '../utils/cache';

const router = Router();

/** Resolve the caller from an optional Bearer token; anonymous on any failure. */
async function resolveOptionalUser(req: Request): Promise<User | null> {
  const token = extractBearerToken(req);
  if (!token) {
    return null;
  }

  const cacheKey = CacheKeys.token(token);
  const cachedUser = cache.get<User>(cacheKey);
  if (cachedUser) {
    return cachedUser;
  }

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    if (user) {
      cache.set(cacheKey, user, TTL.TOKEN);
      return user;
    }
  } catch {
    // Ignore — treat as anonymous.
  }
  return null;
}

/**
 * GET /api/app/status — app status, force-update info, and announcements.
 */
router.get('/status', async (req: Request, res: Response) => {
  const version = String(req.headers['x-app-version'] ?? '0.0.0');
  const platform = String(req.headers['x-app-platform'] ?? 'ios').toLowerCase();

  const user = await resolveOptionalUser(req);
  const result = await getAppStatus(
    version,
    platform,
    user?.id,
    user?.email ?? undefined
  );
  res.json(result);
});

export default router;
