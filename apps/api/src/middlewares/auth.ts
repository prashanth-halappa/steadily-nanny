// middleware/auth.ts
import { fromNodeHeaders } from 'better-auth/node';
import type { NextFunction, Request, Response } from 'express';
import { auth } from '../auth';
import { AuthenticationError } from '../errors';
import { sendErrorResponse } from '../utils/responseHelpers';
import { logger } from './logger';

// Express.Request already carries `user?: Express.AuthUser` via the global augmentation.
export type AuthenticatedRequest = Request;

/**
 * Resolve the Better Auth session from the request's cookie, or null. Never
 * throws for a bad/expired session; a lookup failure (DB down) does throw.
 */
export const resolveSessionUser = async (
  req: Request
): Promise<Express.AuthUser | null> => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session) {
    return null;
  }
  const { id, email, name } = session.user;
  return { id, email, name };
};

/** Attach `req.user` from the session, or answer 401. */
export const validateSession = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = await resolveSessionUser(req);
    if (!user) {
      logger.info('Missing, invalid or expired session');
      sendErrorResponse(res, 'UNAUTHORIZED', 'Invalid or expired token', 401);
      return;
    }
    req.user = user;
    next();
  } catch (error) {
    logger.error('Session validation error:', error);
    sendErrorResponse(
      res,
      'INTERNAL_ERROR',
      'Server error during authentication',
      500
    );
  }
};

/**
 * Require an authenticated user. Runs after `validateSession` inside the route
 * presets. Forwards an AuthenticationError if `req.user` is missing.
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
