/**
 * Timesheet-nested payment routes — routing + middleware wiring only.
 * Mounted at `/api/v1/timesheets/:timesheetId/payments` in `routes/index.ts`,
 * the same nested `Router({ mergeParams: true })` shape as
 * `householdApprovalRoutes.ts`.
 *
 * Three routes, and deliberately still no PATCH and no DELETE. `payments`
 * stays append-only — a payment row is a fact about money that already moved,
 * and immutability in this stack is the ABSENCE of a write path (migration
 * 067's header, `docs/11-MONEY.md` §1). The third route does not change that:
 * `POST .../:paymentId/corrections` APPENDS a negative row pointing at the
 * original (D-20, migration 085) and leaves the original untouched forever. If
 * a PATCH ever looks tempting, it is this route you already have.
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
import {
  CreatePaymentCorrectionSchema,
  CreatePaymentSchema,
  PaymentCorrectionParamSchema,
  TimesheetPaymentsParamSchema,
} from '../schemas';

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

// The correction append (D-20). Nested under the payment it reverses so the
// relationship is in the URL rather than only in the body — a correction with
// no original is not a thing this ledger can hold.
router.post(
  '/:paymentId/corrections',
  ...authWithValidation(PaymentCorrectionParamSchema, 'params'),
  validate(CreatePaymentCorrectionSchema, 'body'),
  asyncHandler(PaymentController.correct)
);

export default router;
