/**
 * Household day-thread route — GET /households/:householdId/day-thread?local_date=
 * Clearly named and separate from shift-scoped `/:shiftId/events` (D24).
 *
 * @module domains/shift/routes/dayThreadRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ShiftController } from '../controllers/shiftController';
import { DayThreadQuerySchema, HouseholdIdParamSchema } from '../schemas';

const router = Router({ mergeParams: true });

router.get(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(DayThreadQuerySchema, 'query'),
  asyncHandler(ShiftController.listDayThread)
);

// S14: the GET is a pure read again. This is the explicit recheck, and it is
// a WRITE — parent-only, gated in the service.
router.post(
  '/refresh',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(DayThreadQuerySchema, 'body'),
  asyncHandler(ShiftController.refreshDayThread)
);

export default router;
