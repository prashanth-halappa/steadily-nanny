/**
 * Availability routes — routing + middleware wiring only. Mounted at
 * `/api/v1/availability` (behind the global Supabase auth). Each route reads
 * as one declarative chain: auth (+ownership) -> validate(input) ->
 * asyncHandler(controller).
 *
 * `/me` routes are registered BEFORE `/:userId` so 'me' is matched as a
 * literal segment, not swallowed by the param route — same reasoning as the
 * household domain's invite routes (see householdRoutes.ts).
 *
 * @module domains/availability/routes/availabilityRoutes
 */
import { Router } from 'express';
import { requireAuth } from '../../../middlewares/auth';
import {
  authWithOwnership,
  authWithValidation,
} from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { AvailabilityController } from '../controllers/availabilityController';
import {
  BusyBlocksQuerySchema,
  CarerIdParamSchema,
  CreateCarerAvailabilitySchema,
  UserIdParamSchema,
} from '../schemas';
import { availabilityQueryService } from '../services/availabilityQueryService';

const router = Router();

// Shared-household ownership guard for /:userId. The lookup throws
// AvailabilityNotFoundError (-> 404) for both "not shared" and "doesn't
// exist" — see availabilityQueryService.listForUser.
const availabilityOwnership = {
  param: 'userId',
  lookup: (callerId: string, userId: string) =>
    availabilityQueryService.listForUser(callerId, userId),
};

// Shared-household ownership guard for /:carerId/busy — same check as above,
// gating the carer's cross-household busy blocks instead of her raw
// availability windows.
const busyBlocksOwnership = {
  param: 'carerId',
  lookup: (callerId: string, carerId: string) =>
    availabilityQueryService.assertShared(callerId, carerId),
};

// List the caller's own availability.
router.get('/me', requireAuth, asyncHandler(AvailabilityController.listOwn));

// Upsert one weekday row for the caller.
router.put(
  '/me',
  ...authWithValidation(CreateCarerAvailabilitySchema, 'body'),
  asyncHandler(AvailabilityController.upsertOwn)
);

// Read another user's availability — only if the caller shares an active
// household with them.
router.get(
  '/:userId',
  ...authWithOwnership(UserIdParamSchema, availabilityOwnership),
  asyncHandler(AvailabilityController.listForUser)
);

// The anonymised cross-household busy-blocks read — the most privacy-critical
// endpoint in this domain (see busyBlockRepository.ts and
// availabilityQueryService.listBusyBlocks).
router.get(
  '/:carerId/busy',
  ...authWithOwnership(CarerIdParamSchema, busyBlocksOwnership),
  validate(BusyBlocksQuerySchema, 'query'),
  asyncHandler(AvailabilityController.listBusyBlocks)
);

export default router;
