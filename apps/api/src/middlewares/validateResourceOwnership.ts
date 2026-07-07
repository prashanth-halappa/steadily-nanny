/**
 * Generic resource-ownership validation middleware factory.
 *
 * The source repo hard-coded "child ownership". Here `makeOwnershipValidator`
 * takes the id param name and a `lookup` function, so any domain can enforce
 * "does this user own this resource?" while keeping the exact positive +
 * negative caching behavior:
 * - Positive hit: the looked-up resource is cached (long TTL) and attached to
 *   the request.
 * - Negative hit: a known-invalid relationship is cached (short TTL) to avoid
 *   hammering the DB with repeated unauthorized lookups.
 *
 * @module middlewares/validateResourceOwnership
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AuthorizationError, NotFoundError } from '../errors';
import { cache, getRelationshipKey, TTL } from '../utils/cache';
import { logger } from './logger';

export interface OwnershipValidatorOptions<T> {
  /** Name of the id field (in params/body/query). */
  param: string;
  /** Where to read the id from (default 'params'). */
  source?: 'params' | 'body' | 'query';
  /**
   * Look up the resource for (userId, resourceId). MUST throw a NotFoundError
   * when the resource does not exist OR is not owned by the user. The returned
   * value is attached to the request for downstream handlers.
   */
  lookup: (userId: string, resourceId: string) => Promise<T>;
  /** Request property to attach the validated resource to (default 'ownedResource'). */
  attachAs?: string;
}

/** Read the resource id from the configured request source. */
function readId(
  req: Request,
  param: string,
  source: 'params' | 'body' | 'query'
): string | undefined {
  if (source === 'params') {
    const value = req.params[param];
    return typeof value === 'string' ? value : undefined;
  }
  if (source === 'query') {
    const query =
      (req.validatedQuery as Record<string, unknown> | undefined) ?? req.query;
    const value = query?.[param];
    return typeof value === 'string' ? value : undefined;
  }
  const value = (req.body as Record<string, unknown> | undefined)?.[param];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Build an ownership-validation middleware for a resource type.
 */
export function makeOwnershipValidator<T>(
  options: OwnershipValidatorOptions<T>
): RequestHandler {
  const { param, lookup } = options;
  const source = options.source ?? 'params';
  const attachAs = options.attachAs ?? 'ownedResource';
  const convertNotFoundToForbidden = source === 'body' || source === 'query';

  return async (
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AuthorizationError('User not authenticated', 'UNAUTHORIZED');
      }

      const resourceId = readId(req, param, source);
      if (!resourceId) {
        throw new NotFoundError(
          `Resource id (${param}) not provided`,
          'RESOURCE_NOT_FOUND'
        );
      }

      const cacheKey = getRelationshipKey(userId, resourceId);
      const cached = cache.get<T | boolean>(cacheKey);

      if (cached !== undefined) {
        if (cached === false) {
          if (convertNotFoundToForbidden) {
            throw new AuthorizationError(
              'You do not have access to this resource',
              'INSUFFICIENT_PERMISSIONS'
            );
          }
          throw new NotFoundError(
            'Resource not found (cached)',
            'RESOURCE_NOT_FOUND'
          );
        }
        (req as unknown as Record<string, unknown>)[attachAs] = cached;
        next();
        return;
      }

      try {
        const resource = await lookup(userId, resourceId);
        cache.set(cacheKey, resource, TTL.RELATIONSHIP);
        (req as unknown as Record<string, unknown>)[attachAs] = resource;
        next();
      } catch (error) {
        if (error instanceof NotFoundError) {
          cache.set(cacheKey, false, TTL.RELATIONSHIP_NEGATIVE);
          if (convertNotFoundToForbidden) {
            throw new AuthorizationError(
              'You do not have access to this resource',
              'INSUFFICIENT_PERMISSIONS'
            );
          }
        }
        throw error;
      }
    } catch (error) {
      const isExpected =
        error instanceof AuthorizationError || error instanceof NotFoundError;
      if (!isExpected) {
        logger.error('Resource ownership validation failed:', {
          error,
          userId: req.user?.id,
          param,
        });
      }
      next(error);
    }
  };
}
