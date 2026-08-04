/**
 * Household-nested closure routes — parent-declared "we're away".
 * Mounted at `/api/v1/households/:householdId/closures`.
 *
 * @module domains/availability/routes/householdClosureRoutes
 */
import { Router } from 'express';
import { z } from 'zod';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { HouseholdClosureController } from '../controllers/householdClosureController';
import {
  CreateHouseholdClosureSchema,
  UpdateHouseholdClosureSchema,
} from '../schemas';

const HouseholdIdParamSchema = z.object({
  householdId: z.uuid(),
});

const HouseholdClosureParamsSchema = z.object({
  householdId: z.uuid(),
  closureId: z.uuid(),
});

const router = Router({ mergeParams: true });

router.get(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  asyncHandler(HouseholdClosureController.list)
);

router.post(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(CreateHouseholdClosureSchema, 'body'),
  asyncHandler(HouseholdClosureController.create)
);

router.patch(
  '/:closureId',
  ...authWithValidation(HouseholdClosureParamsSchema, 'params'),
  validate(UpdateHouseholdClosureSchema, 'body'),
  asyncHandler(HouseholdClosureController.update)
);

router.delete(
  '/:closureId',
  ...authWithValidation(HouseholdClosureParamsSchema, 'params'),
  asyncHandler(HouseholdClosureController.remove)
);

export default router;
