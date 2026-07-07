import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodSchema, type ZodTypeAny } from 'zod';

/**
 * Validate `req[property]` against a Zod schema. On failure, forwards a ZodError
 * to the global error handler (which turns it into a 400). On success, writes
 * the parsed data back — to `req.validatedQuery` for query (Express 5 makes
 * `req.query` read-only), or in place for body/params.
 */
export function validate<T = unknown>(
  schema: ZodSchema<T> | ZodTypeAny,
  property: 'body' | 'query' | 'params' = 'body'
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const result = schema.safeParse(req[property]);
      if (!result.success) {
        const error = new ZodError(result.error.issues);
        error.name = 'ValidationError';
        return next(error);
      }

      if (property === 'query') {
        req.validatedQuery = result.data as Record<string, unknown>;
      } else {
        req[property] = result.data;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
