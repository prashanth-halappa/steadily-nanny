/**
 * Household-nested payment routes — routing + middleware wiring only.
 * Mounted at `/api/v1/households/:householdId/payments` in `routes/index.ts`,
 * the same nested `Router({ mergeParams: true })` shape as
 * `expenseRoutes`'s household router.
 *
 * ONE route, and deliberately no second: GET only. Recording a payment stays
 * week-scoped (`paymentRoutes`), because the over-payment gate is defined
 * against ONE week's frozen `gross_minor` (`docs/11-MONEY.md` §11) — a
 * household-scoped POST would have no ceiling to check against.
 *
 * `authWithValidation`, never `authWithOwnership`: the pay domain uses the
 * generic ownership middleware nowhere at all, for the reason `expenseRoutes`
 * and `paymentRoutes` both spell out — it caches "does this user own this
 * resource" per (userId, resourceId) with no notion of which action is being
 * checked. Here the gate is not even binary: `assertPaymentReader` resolves a
 * SCOPE (the whole household, or just this carer's rows), which no ownership
 * cache can express. It lives at the top of the service method.
 *
 * @module domains/pay/routes/householdPaymentRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { asyncHandler } from '../../../utils/asyncHandler';
import { PaymentController } from '../controllers/paymentController';
import { HouseholdIdParamSchema } from '../schemas';

// mergeParams so `:householdId` from the parent mount is visible on
// req.params (and therefore validatable by HouseholdIdParamSchema).
const router = Router({ mergeParams: true });

router.get(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  asyncHandler(PaymentController.listForHousehold)
);

export default router;
