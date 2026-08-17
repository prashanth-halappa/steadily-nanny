/**
 * Carer-nested pay-arrangement routes — routing + middleware wiring only.
 * Mounted at `/api/v1/households/:householdId/carers/:carerId/pay-arrangements`
 * in `routes/index.ts`.
 *
 * `pay_arrangements` itself is READ-ONLY over HTTP. There is no POST here,
 * and no PATCH and no DELETE either. The table is append-only — a correction
 * is a new row that supersedes the old one via `effectiveOn`'s `created_at
 * desc` tie-break (migration 041's header) — and immutability in this stack
 * is the ABSENCE of a write path, so adding any of the three would quietly
 * undo it.
 *
 * THE POST IS DELETED, NOT DISABLED (P1). A client could once write terms
 * here directly, with no proposal behind them — so those terms could never be
 * accepted by anyone, and the clock-in gate (which only asks whether an
 * arrangement EXISTS) opened for a nanny against terms she had never seen.
 * `payArrangementCommandService.create` now has exactly ONE caller,
 * `termsProposalCommandService.accept`, which makes "an arrangement exists"
 * and "someone tapped Agree with the checkbox ticked" the same fact.
 * `cancelScheduled` below still appends its revert row; it writes no terms
 * that were not already agreed.
 *
 * Stated out loud: an installed older client's term-setting POST now 404s
 * until it updates. That is the right failure direction — a 404'd write mints
 * nothing — but it is a deliberate compatibility cut, not an oversight.
 *
 * `.../:arrangementId/ack` and `.../:arrangementId/dissent` (D-31/D-45) are
 * a DIFFERENT resource — `pay_arrangement_acks` (081) — and are POSTs for
 * exactly the same reason: the ack table is append-only too, so "recording a
 * second ack" is a create, never an update of the first one.
 *
 * `authWithValidation` (not `authWithOwnership`): the ownership middleware
 * takes a `lookup` for ONE resource id, and these routes are scoped by a
 * (household, carer[, arrangement]) tuple whose gating differs per verb —
 * parents-plus-the-carer-herself on read, parents only on arrangement write,
 * the carer-herself-only on ack/dissent. Every check therefore lives at the
 * top of the relevant service method, the same place the D12-class carer
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
  CreatePayArrangementAckRequestSchema,
  HouseholdCarerArrangementParamSchema,
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
  '/:arrangementId/ack',
  ...authWithValidation(HouseholdCarerArrangementParamSchema, 'params'),
  asyncHandler(PayArrangementController.ack)
);

router.post(
  '/:arrangementId/dissent',
  ...authWithValidation(HouseholdCarerArrangementParamSchema, 'params'),
  validate(CreatePayArrangementAckRequestSchema, 'body'),
  asyncHandler(PayArrangementController.dissent)
);

router.get(
  '/:arrangementId/acks',
  ...authWithValidation(HouseholdCarerArrangementParamSchema, 'params'),
  asyncHandler(PayArrangementController.listAcks)
);

// D-16/§6 — appends the revert row (see cancelScheduled's own doc); parents
// only, same gate as the arrangement write above.
router.post(
  '/:arrangementId/cancel-scheduled',
  ...authWithValidation(HouseholdCarerArrangementParamSchema, 'params'),
  asyncHandler(PayArrangementController.cancelScheduled)
);

export default router;
