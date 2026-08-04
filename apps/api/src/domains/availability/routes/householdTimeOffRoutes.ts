/**
 * Household-nested time-off routes — list carers' time off for one household.
 * Mounted at `/api/v1/households/:householdId/time-off`.
 *
 * @module domains/availability/routes/householdTimeOffRoutes
 */
import { Router } from 'express';
import { z } from 'zod';
import { authWithValidation } from '../../../middlewares/presets';
import { asyncHandler } from '../../../utils/asyncHandler';
import { TimeOffController } from '../controllers/timeOffController';

const HouseholdIdParamSchema = z.object({
  householdId: z.uuid(),
});

const router = Router({ mergeParams: true });

router.get(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  asyncHandler(TimeOffController.listForHousehold)
);

export default router;
