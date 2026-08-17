/**
 * PTO routes — routing + middleware wiring only. Every authorization
 * decision (the read gate, the parent gate, the D12-class time-off
 * assertion, the status guard) lives in
 * `ptoQueryService`/`ptoCommandService`; see those modules' docs.
 *
 * ONE router covering FIVE endpoints, because they split across TWO
 * different address shapes and this domain's file surface keeps them
 * together (unlike `expenseRoutes.ts`'s two-router split for a genuinely
 * flat id-scoped resource): balance/ledger are addressed by
 * (household, carer) — carer-nested, same shape as `payArrangementRoutes` —
 * while mark-paid and the two DEPARTED-CARER reads are addressed by
 * household alone. For mark-paid the carer is DERIVED from the time off's
 * `user_id`, never accepted as a URL param; for the two reads there is no
 * carer id left to accept (033 NULLs it), which is the whole point of them.
 * `mergeParams: true` on this router plus
 * mounting it at `/households/:householdId` (see the mount note below)
 * lets both shapes share one file without a param mismatch: `householdId`
 * always comes from the mount, `carerId` only exists on the two routes that
 * declare it in their own path.
 *
 * MOUNT LINE for `routes/index.ts` (not added here — see this task's
 * ownership boundary):
 *   router.use('/households/:householdId', ptoRoutes);
 * A prefix mount is safe here: Express's Router, used as middleware, calls
 * `next()` when none of ITS OWN routes match, so a request for any other
 * `/households/:householdId/...` domain (timesheets, shifts, ...) falls
 * through to whichever `.use()` actually owns it — mount order relative to
 * those other routers does not matter.
 *
 * `authWithValidation` EVERYWHERE, deliberately NEVER `authWithOwnership` —
 * same reasoning as `payArrangementRoutes`/`expenseRoutes`: the ownership
 * middleware's cache has no notion of which of several different
 * authorization rules is in play for a given id, so every check stays in
 * the service layer and these routes validate SHAPE only.
 *
 * @module domains/pay/routes/ptoRoutes
 */
import { MarkTimeOffPaidRequestSchema } from '@steadily-nanny/shared-types/schemas/pto.schema';
import { Router } from 'express';
import { z } from 'zod';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { PayArrangementController } from '../controllers/payArrangementController';
import { PtoController } from '../controllers/ptoController';
import { HouseholdCarerParamSchema, PtoYearQuerySchema } from '../schemas';

/** URL param validation for every household-only route in this file. */
const HouseholdIdParamSchema = z.object({
  householdId: z.uuid(),
});

// mergeParams so `:householdId` from the parent mount (and `:carerId` from
// this router's own sub-paths) are visible on req.params.
const router = Router({ mergeParams: true });

router.get(
  '/carers/:carerId/pto/balance',
  ...authWithValidation(HouseholdCarerParamSchema, 'params'),
  validate(PtoYearQuerySchema, 'query'),
  asyncHandler(PtoController.balance)
);

router.get(
  '/carers/:carerId/pto/ledger',
  ...authWithValidation(HouseholdCarerParamSchema, 'params'),
  validate(PtoYearQuerySchema, 'query'),
  asyncHandler(PtoController.ledger)
);

// THE DEPARTED-CARER READS (033/058). Both are household-only addresses:
// `carer_id` goes NULL when a carer deletes her account, so every
// carer-nested route above becomes unreachable for her while her ledger rows
// and her agreed terms sit in the tables being the record a back-pay question
// is settled against. Parents/owner only — the services gate it.
//
// `/pay-arrangements` lives in THIS file rather than
// `payArrangementRoutes.ts` because that router is mounted at
// `/households/:householdId/carers/:carerId/pay-arrangements` and this
// address has no `:carerId` in it; this is the router already mounted at the
// bare household prefix. Move it out the day a household-scoped pay router
// earns its own mount line in `routes/index.ts`.
router.get(
  '/pto/ledger',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(PtoYearQuerySchema, 'query'),
  asyncHandler(PtoController.householdLedger)
);

router.get(
  '/pay-arrangements',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  asyncHandler(PayArrangementController.listForHousehold)
);

router.post(
  '/pto/mark-paid',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(MarkTimeOffPaidRequestSchema, 'body'),
  asyncHandler(PtoController.markPaid)
);

export default router;
