/**
 * Job authentication middleware.
 *
 * Validates the shared API key for scheduled-job endpoints. Used by
 * pg_cron/pg_net (or any external scheduler) to authenticate HTTP calls.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { sendErrorResponse } from '../utils/responseHelpers';
import { logger } from './logger';

// Hash to a fixed-length buffer so timingSafeEqual never throws on length
// mismatch (which would itself leak information).
function hashKey(key: string): Buffer {
  return createHash('sha256').update(key).digest();
}

/**
 * Validate the X-Job-Api-Key header against JOB_API_KEY. Uses a timing-safe
 * comparison to prevent timing-based key enumeration.
 */
export function validateJobApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.headers['x-job-api-key'];
  const expectedKey = process.env.JOB_API_KEY;

  if (!expectedKey) {
    logger.error('JOB_API_KEY environment variable not configured');
    sendErrorResponse(res, 'INTERNAL_ERROR', 'Server configuration error', 500);
    return;
  }

  if (!apiKey || typeof apiKey !== 'string') {
    logger.warn('Missing job API key', { path: req.path, ip: req.ip });
    sendErrorResponse(res, 'UNAUTHORIZED', 'Unauthorized', 401);
    return;
  }

  const valid = timingSafeEqual(hashKey(apiKey), hashKey(expectedKey));
  if (!valid) {
    logger.warn('Invalid job API key', { path: req.path, ip: req.ip });
    sendErrorResponse(res, 'UNAUTHORIZED', 'Unauthorized', 401);
    return;
  }

  next();
}
