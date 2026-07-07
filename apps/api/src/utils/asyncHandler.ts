/**
 * Wraps an async Express controller so unhandled rejections are forwarded to the
 * Express error handler via `next()`.
 *
 * @module utils/asyncHandler
 */
import type { NextFunction, Request, Response } from 'express';

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown> | unknown;

export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Extracts the authenticated user ID. Safe in routes behind
 * `validateSupabaseToken`, which guarantees `req.user.id`.
 */
export function getAuthUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) {
    throw new Error('Unreachable: auth middleware guarantees user');
  }
  return id;
}
