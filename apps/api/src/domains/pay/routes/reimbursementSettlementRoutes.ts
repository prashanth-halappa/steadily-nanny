/**
 * Reimbursement settlement routes — routing + middleware wiring only. Mounted
 * at `/api/v1/households/:householdId/reimbursement-settlements`, the same
 * nested `Router({ mergeParams: true })` shape as `householdPaymentRoutes`.
 *
 * `authWithValidation`, NEVER `authWithOwnership`: the pay domain uses the
 * generic ownership middleware nowhere at all, for the reason every route file
 * here spells out (GOLDEN-FIXES #32) — it caches "does this user own this
 * resource" per (userId, resourceId) with no notion of which action is being
 * checked. Here the read gate is not even binary: it resolves a SCOPE (the
 * whole household, or only this carer's rows), which no ownership cache can
 * express, and the write gate is a different question again. Both live at the
 * top of the service methods.
 *
 * GET and POST, and deliberately no PATCH or DELETE: the table is append-only
 * and has no correction path (migration 086, attention spec §4.2).
 *
 * @module domains/pay/routes/reimbursementSettlementRoutes
 */
import { CreateReimbursementSettlementSchema } from '@steadily-nanny/shared-types/schemas/reimbursementSettlement.schema';
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ReimbursementSettlementController } from '../controllers/reimbursementSettlementController';
import {
  HouseholdIdParamSchema,
  ReimbursementSettlementListQuerySchema,
} from '../schemas';

// mergeParams so `:householdId` from the parent mount is visible on req.params
// (and therefore validatable by HouseholdIdParamSchema).
const router = Router({ mergeParams: true });

router.get(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(ReimbursementSettlementListQuerySchema, 'query'),
  asyncHandler(ReimbursementSettlementController.list)
);

router.post(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(CreateReimbursementSettlementSchema, 'body'),
  asyncHandler(ReimbursementSettlementController.create)
);

export default router;
