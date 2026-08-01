/**
 * Household-nested time-entry routes — routing + middleware wiring only.
 * Mounted at `/api/v1/households/:householdId/time-entries` in
 * `routes/index.ts`. Membership checks live in the service layer (see
 * `timesheetQueryService`), same as the schedule/shift domains'
 * household-nested routes, rather than the generic single-param ownership
 * middleware.
 *
 * @module domains/timesheet/routes/householdTimeEntryRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { TimesheetController } from '../controllers/timesheetController';
import { HouseholdIdParamSchema, WeekQuerySchema } from '../schemas';

// mergeParams so `:householdId` from the parent mount is visible on req.params.
const router = Router({ mergeParams: true });

router.get(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(WeekQuerySchema, 'query'),
  asyncHandler(TimesheetController.listForHouseholdWeek)
);

export default router;
