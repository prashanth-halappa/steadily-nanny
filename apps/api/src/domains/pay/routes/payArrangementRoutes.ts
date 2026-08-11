/**
 * Carer-nested pay-arrangement routes — routing + middleware wiring only.
 * Mounted at `/api/v1/households/:householdId/carers/:carerId/pay-arrangements`
 * in `routes/index.ts`.
 *
 * `pay_arrangements` itself has three routes and deliberately no fourth:
 * there is no PATCH and no DELETE on the arrangement resource. `terms` is
 * append-only — a correction is a POST of a new row that supersedes the old
 * one via `effectiveOn`'s `created_at desc` tie-break (migration 041's
 * header). Immutability in this stack is the absence of a write path, so
 * adding a PATCH/DELETE there would quietly undo it.
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
  CreatePayArrangementRequestSchema,
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
  '/',
  ...authWithValidation(HouseholdCarerParamSchema, 'params'),
  validate(CreatePayArrangementRequestSchema, 'body'),
  asyncHandler(PayArrangementController.create)
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

export default router;
