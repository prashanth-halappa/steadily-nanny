/**
 * Household-nested schedule-pattern routes — routing + middleware wiring
 * only. Mounted at `/api/v1/households/:householdId/schedule-patterns` in
 * `routes/index.ts`. Membership and role checks live in the service layer
 * (see `schedulePatternQueryService`/`schedulePatternCommandService`), same
 * as the child domain's household-nested routes, rather than the generic
 * single-param ownership middleware — these routes are scoped by the
 * household id alone, but "may write" is a ROLE check the service already
 * owns.
 *
 * @module domains/schedule/routes/householdSchedulePatternRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { SchedulePatternController } from '../controllers/schedulePatternController';
import {
  CreateSchedulePatternSchema,
  HouseholdIdParamSchema,
} from '../schemas';

// mergeParams so `:householdId` from the parent mount
// (`/households/:householdId/schedule-patterns`, wired in routes/index.ts)
// is visible on req.params.
const router = Router({ mergeParams: true });

router.get(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  asyncHandler(SchedulePatternController.list)
);

router.post(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(CreateSchedulePatternSchema, 'body'),
  asyncHandler(SchedulePatternController.create)
);

export default router;
