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
import {
  CarerPaySummaryQuerySchema,
  CarerQuerySchema,
  HouseholdIdParamSchema,
  YearEndSummaryQuerySchema,
} from '../schemas';

// mergeParams so `:householdId` from the parent mount is visible on req.params.
const router = Router({ mergeParams: true });

router.get(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(CarerQuerySchema, 'query'),
  asyncHandler(TimesheetController.listTimesheetsForHousehold)
);

// D-29/P11 — mounted BEFORE any `/:id`-shaped sibling route (there is none
// here today, but `pay-summary.csv`/`year-end.csv` would otherwise risk
// being swallowed by one added later at this same level).
router.get(
  '/pay-summary.csv',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(CarerPaySummaryQuerySchema, 'query'),
  asyncHandler(TimesheetController.exportCarerPaySummaryCsv)
);

// D-29/P12.
router.get(
  '/year-end.csv',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(YearEndSummaryQuerySchema, 'query'),
  asyncHandler(TimesheetController.exportYearEndSummaryCsv)
);

export default router;
