// Middleware preset chains for common route patterns.
// Compose these with a spread so a route reads as one declarative chain:
//   router.get('/:id', ...authWithValidation(IdParamSchema), asyncHandler(Ctrl.get));
import type { RequestHandler } from 'express';
import type { ZodSchema, ZodTypeAny } from 'zod';
import { requireAuth } from './auth';
import {
  makeOwnershipValidator,
  type OwnershipValidatorOptions,
} from './validateResourceOwnership';
import { validate } from './validator';

type ValidateTarget = 'params' | 'body' | 'query';

/** Auth + validation only (no ownership check). */
export const authWithValidation = (
  schema: ZodSchema | ZodTypeAny,
  target: ValidateTarget = 'params'
): RequestHandler[] => [requireAuth, validate(schema, target)];

/**
 * Auth + validation + resource-ownership check. Supply a `lookup` (see
 * `makeOwnershipValidator`) that throws NotFoundError when the user doesn't own
 * the resource.
 */
export const authWithOwnership = <T>(
  schema: ZodSchema | ZodTypeAny,
  ownership: OwnershipValidatorOptions<T>,
  target: ValidateTarget = 'params'
): RequestHandler[] => [
  requireAuth,
  validate(schema, target),
  makeOwnershipValidator(ownership),
];
