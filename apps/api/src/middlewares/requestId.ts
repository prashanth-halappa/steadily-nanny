import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Assigns a unique request ID for correlation across logs and responses. Runs
 * before anything that logs.
 */
export const requestId = (req: Request, res: Response, next: NextFunction) => {
  const id = randomUUID();

  // errorHandler reads req.id; other middlewares read res.locals.requestId.
  req.id = id;
  res.locals.requestId = id;
  res.setHeader('X-Request-ID', id);

  next();
};
