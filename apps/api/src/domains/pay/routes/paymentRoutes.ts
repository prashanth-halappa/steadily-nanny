/**
 * Timesheet-nested payment routes — routing + middleware wiring only.
 * Mounted at `/api/v1/timesheets/:timesheetId/payments` in `routes/index.ts`,
 * the same nested `Router({ mergeParams: true })` shape as
 * `householdApprovalRoutes.ts`.
 *
 * Two routes, and deliberately no third: there is no PATCH and no DELETE.
 * `payments` is append-only — a payment row is a fact about money that
 * already moved, and a mistake is prevented at write time by the
 * over-payment gate rather than corrected by editing history (migration
 * 067's header, `docs/11-MONEY.md` §1). Immutability in this stack is the
 * absence of a write path, so adding one here would quietly undo it.
 *
 * `authWithValidation` (not `authWithOwnership`), for the same reason the
 * expense routes give: one `timesheetId` carries TWO different "may act"
 * meanings — a parent may record a payment, while the week's carer may only
 * read one — and the generic ownership validator caches by
 * `(userId, resourceId)` with no lookup identity, so a permitted read would
 * leave a positive entry the write then reuses. Both gates therefore live at
 * the top of their service method.
 *
 * @module domains/pay/routes/paymentRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { PaymentController } from '../controllers/paymentController';
import { CreatePaymentSchema, TimesheetPaymentsParamSchema } from '../schemas';

// mergeParams so `:timesheetId` from the parent mount is visible on
// req.params (and therefore validatable by TimesheetPaymentsParamSchema).
const router = Router({ mergeParams: true });

router.get(
  '/',
  ...authWithValidation(TimesheetPaymentsParamSchema, 'params'),
  asyncHandler(PaymentController.list)
);

router.post(
  '/',
  ...authWithValidation(TimesheetPaymentsParamSchema, 'params'),
  validate(CreatePaymentSchema, 'body'),
  asyncHandler(PaymentController.create)
);

export default router;
