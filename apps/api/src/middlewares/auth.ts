// middleware/auth.ts
import type { User } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
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
      logger.info('Invalid or expired token');
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
