/**
 * Household-nested shift routes — routing + middleware wiring only. Mounted
 * at `/api/v1/households/:householdId/shifts` in `routes/index.ts`.
 * Membership checks live in the service layer (see `shiftQueryService`),
 * same as the schedule domain's household-nested routes, rather than the
 * generic single-param ownership middleware — these routes are scoped by the
 * household id alone.
 *
 * @module domains/shift/routes/householdShiftRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ShiftChangeRequestController } from '../controllers/shiftChangeRequestController';
import { ShiftController } from '../controllers/shiftController';
import {
  CreateExtraShiftSchema,
  CreateParentCoverSchema,
  HouseholdIdParamSchema,
  HouseholdShiftIdParamSchema,
  ShiftRangeQuerySchema,
} from '../schemas';

// mergeParams so `:householdId` (and, on the nested /:shiftId/events route,
// `:shiftId`) from the parent mount are visible on req.params.
const router = Router({ mergeParams: true });

// The primary calendar feed.
router.get(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(ShiftRangeQuerySchema, 'query'),
  asyncHandler(ShiftController.listForHousehold)
);

// One-off extra shift proposal (flow 1d) — must precede /:shiftId routes.
router.post(
  '/extra',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(CreateExtraShiftSchema, 'body'),
  asyncHandler(ShiftChangeRequestController.createExtraShift)
);

// Parent self-cover ("I've got it") — must precede /:shiftId routes.
router.post(
  '/parent-cover',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(CreateParentCoverSchema, 'body'),
  asyncHandler(ShiftController.createParentCover)
);

// The append-only day thread for one shift.
router.get(
  '/:shiftId/events',
  ...authWithValidation(HouseholdShiftIdParamSchema, 'params'),
  asyncHandler(ShiftController.listEvents)
);

export default router;
