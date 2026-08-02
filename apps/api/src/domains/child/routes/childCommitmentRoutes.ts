/**
 * Child-commitment routes, nested under a child — routing + middleware
 * wiring only. Mounted at
 * `/api/v1/households/:householdId/children/:childId/commitments` in
 * `routes/index.ts`. Membership checks live in the service layer (see
 * `childCommitmentQueryService`/`childCommitmentCommandService`) rather than
 * the generic single-param ownership middleware — these routes are scoped by
 * TWO ids (household + child), same shape as `childRoutes.ts`.
 *
 * @module domains/child/routes/childCommitmentRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ChildCommitmentController } from '../controllers/childCommitmentController';
import {
  CreateChildCommitmentSchema,
  HouseholdChildParamsSchema,
} from '../schemas';

// mergeParams so `:householdId`/`:childId` from the parent mounts
// (`/households/:householdId/children/:childId/commitments`, wired in
// routes/index.ts) are visible on req.params.
const router = Router({ mergeParams: true });

router.get(
  '/',
  ...authWithValidation(HouseholdChildParamsSchema, 'params'),
  asyncHandler(ChildCommitmentController.list)
);

router.post(
  '/',
  ...authWithValidation(HouseholdChildParamsSchema, 'params'),
  validate(CreateChildCommitmentSchema, 'body'),
  asyncHandler(ChildCommitmentController.create)
);

export default router;
