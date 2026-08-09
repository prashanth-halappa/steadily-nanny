/**
 * Household-wide child-commitment list — routing + middleware wiring only.
 * Mounted at `/api/v1/households/:householdId/commitments` in
 * `routes/index.ts`. Membership checks live in the service layer (see
 * `childCommitmentQueryService.listForHousehold`).
 *
 * @module domains/child/routes/householdCommitmentRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ChildCommitmentController } from '../controllers/childCommitmentController';
import { HouseholdIdOnlyParamSchema } from '../schemas';

const router = Router({ mergeParams: true });

router.get(
  '/',
  ...authWithValidation(HouseholdIdOnlyParamSchema, 'params'),
  asyncHandler(ChildCommitmentController.listForHousehold)
);

export default router;
