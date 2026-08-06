/**
 * Household-nested timesheet routes — routing + middleware wiring only.
 * Mounted at `/api/v1/households/:householdId/timesheets` in
 * `routes/index.ts`.
 *
 * @module domains/timesheet/routes/householdTimesheetRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { TimesheetController } from '../controllers/timesheetController';
import { CarerQuerySchema, HouseholdIdParamSchema } from '../schemas';

// mergeParams so `:householdId` from the parent mount is visible on req.params.
const router = Router({ mergeParams: true });

router.get(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(CarerQuerySchema, 'query'),
  asyncHandler(TimesheetController.listTimesheetsForHousehold)
);

export default router;
