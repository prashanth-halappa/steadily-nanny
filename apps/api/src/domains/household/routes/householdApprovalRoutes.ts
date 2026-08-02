/**
 * Household-nested co-parent approval routes — routing + middleware wiring
 * only. Mounted at `/api/v1/households/:householdId/approvals` in
 * `routes/index.ts`. Membership + role checks live in the service layer
 * (owner/parent only — see `assertHouseholdWriteRole`), same as the
 * schedule domain's household-nested routes, rather than the generic
 * single-param ownership middleware.
 *
 * There is deliberately NO `POST /` here — opening a pending approval is an
 * internal side effect of another domain's command service calling
 * `approvalGateService.assertApprovalAllows` (or
 * `coParentApprovalCommandService.create` directly), never a direct client
 * write. See `services/coParentApprovalCommandService.ts`.
 *
 * @module domains/household/routes/householdApprovalRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApprovalController } from '../controllers/approvalController';
import {
  HouseholdApprovalIdParamSchema,
  HouseholdIdParamSchema,
  RespondToCoParentApprovalSchema,
} from '../schemas';

// mergeParams so `:householdId` from the parent mount is visible on req.params.
const router = Router({ mergeParams: true });

// List pending approvals — owner/parent only (role check in the query service).
router.get(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  asyncHandler(ApprovalController.listPending)
);

// Approve/decline — owner/parent only (role check in the command service).
router.patch(
  '/:approvalId',
  ...authWithValidation(HouseholdApprovalIdParamSchema, 'params'),
  validate(RespondToCoParentApprovalSchema, 'body'),
  asyncHandler(ApprovalController.respond)
);

export default router;
