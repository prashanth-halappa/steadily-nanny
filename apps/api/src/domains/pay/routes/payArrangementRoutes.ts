/**
 * Carer-nested pay-arrangement routes — routing + middleware wiring only.
 * Mounted at `/api/v1/households/:householdId/carers/:carerId/pay-arrangements`
 * in `routes/index.ts`.
 *
 * Three routes, and deliberately no fourth: there is no PATCH and no DELETE
 * anywhere in this domain. `pay_arrangements` is append-only — a correction is
 * a POST of a new row that supersedes the old one via `effectiveOn`'s
 * `created_at desc` tie-break (migration 041's header). Immutability in this
 * stack is the absence of a write path, so adding one here would quietly undo
 * it.
 *
 * `authWithValidation` (not `authWithOwnership`): the ownership middleware
 * takes a `lookup` for ONE resource id, and these routes are scoped by a
 * (household, carer) PAIR whose gating differs per verb — parents-plus-the-
 * carer-herself on read, parents only on write. Both checks therefore live at
 * the top of their service method, the same place the D12-class carer
 * assertion does.
 *
 * @module domains/pay/routes/payArrangementRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { PayArrangementController } from '../controllers/payArrangementController';
import {
  CreatePayArrangementRequestSchema,
  HouseholdCarerParamSchema,
} from '../schemas';

// mergeParams so `:householdId`/`:carerId` from the parent mount are visible
// on req.params (and therefore validatable by HouseholdCarerParamSchema).
const router = Router({ mergeParams: true });

router.get(
  '/current',
  ...authWithValidation(HouseholdCarerParamSchema, 'params'),
  asyncHandler(PayArrangementController.getCurrent)
);

router.get(
  '/',
  ...authWithValidation(HouseholdCarerParamSchema, 'params'),
  asyncHandler(PayArrangementController.list)
);

router.post(
  '/',
  ...authWithValidation(HouseholdCarerParamSchema, 'params'),
  validate(CreatePayArrangementRequestSchema, 'body'),
  asyncHandler(PayArrangementController.create)
);

export default router;
