// middleware/auth.ts
import type { User } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { supabase } from '../config/supabase';
import { AuthenticationError } from '../errors';
import { CacheKeys, cache, TTL } from '../utils/cache';
import { sendErrorResponse } from '../utils/responseHelpers';
import { logger } from './logger';

// Express.Request already carries `user?: User` via the global augmentation.
export type AuthenticatedRequest = Request;

/** Extract the Bearer token from the Authorization header, or null. */
export const extractBearerToken = (req: Request): string | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  return token || null;
};

/**
 * A JWT minted by a DIFFERENT Supabase project can never validate here, no
 * matter how fresh it is. That is a config mismatch — API and client pointed at
 * different projects — but it is indistinguishable from an expired session at
 * the HTTP layer: every request 401s and the app signs itself out at the
 * welcome wall. GOLDEN-FIXES #26; it has now cost multiple debugging sessions,
 * most recently 17 hours of a dev server holding a stale exported
 * SUPABASE_URL while the app authenticated against production.
 *
 * The startup banner in `config/supabase.ts` only catches dev-pointed-at-remote
 * — it cannot see the client's project. This can: the issuer is in the token.
 *
 * Returns the token's issuer host when it disagrees with ours, else null.
 */
const mismatchedIssuerHost = (token: string): string | null => {
  try {
    const payload = token.split('.')[1];
    if (!payload) {
      return null;
    }
    const { iss } = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as { iss?: string };
    if (!iss) {
      return null;
    }
    const tokenHost = new URL(iss).host;
    return tokenHost === new URL(env.SUPABASE_URL).host ? null : tokenHost;
  } catch {
    // Unparseable token — genuinely invalid, let the normal path report it.
    return null;
  }
};

/**
 * Validate a Supabase JWT: cache lookup → verify with Supabase → cache. Caching
 * avoids a round-trip to Supabase Auth on every request.
 */
export const validateSupabaseToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      logger.warn('Missing or invalid authorization header');
      sendErrorResponse(
        res,
        'UNAUTHORIZED',
        'Missing or invalid authorization header',
        401
      );
      return;
    }

    // 1. Cache.
    const cacheKey = CacheKeys.token(token);
    const cachedUser = cache.get<User>(cacheKey);
    if (cachedUser) {
      req.user = cachedUser;
      next();
      return;
    }

    // 2. Verify with Supabase.
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      // Same 401 to the client either way — never leak which project we trust.
      const issuerHost = mismatchedIssuerHost(token);
      if (issuerHost) {
        logger.error(
          `SUPABASE PROJECT MISMATCH: token was issued by ${issuerHost}, but this API validates against ${new URL(env.SUPABASE_URL).host}. ` +
            'Every authenticated request will 401 and the app will sign itself out. ' +
            'Point the API and the client at the same project (check for stale exported SUPABASE_URL in the dev server shell) — the session is fine.'
        );
      } else {
        logger.info('Invalid or expired token');
      }
      sendErrorResponse(res, 'UNAUTHORIZED', 'Invalid or expired token', 401);
      return;
    }

    // 3. Cache + attach.
    cache.set(cacheKey, user, TTL.TOKEN);
    req.user = user;
    next();
  } catch (error) {
    logger.error('Token validation error:', error);
    sendErrorResponse(
      res,
      'INTERNAL_ERROR',
      'Server error during authentication',
      500
    );
  }
};

/**
 * Require an authenticated user. Runs after `validateSupabaseToken` inside the
 * route presets. Forwards an AuthenticationError if `req.user` is missing.
 */
export const requireAuth = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void => {
  if (!req.user?.id) {
    next(new AuthenticationError('User not authenticated'));
    return;
  }
  next();
};
