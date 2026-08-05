/**
 * PTO routes — routing + middleware wiring only. Every authorization
 * decision (the read gate, the parent gate, the D12-class time-off
 * assertion, the status guard) lives in
 * `ptoQueryService`/`ptoCommandService`; see those modules' docs.
 *
 * ONE router covering all three endpoints, because they split across TWO
 * different address shapes and this domain's file surface keeps them
 * together (unlike `expenseRoutes.ts`'s two-router split for a genuinely
 * flat id-scoped resource): balance/ledger are addressed by
 * (household, carer) — carer-nested, same shape as `payArrangementRoutes` —
 * while mark-paid is addressed by household alone (the carer is DERIVED
 * from the time off's `user_id`, never accepted as a URL param, so there is
 * no carer-nested address for it). `mergeParams: true` on this router plus
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
import { PtoController } from '../controllers/ptoController';
import { HouseholdCarerParamSchema, PtoYearQuerySchema } from '../schemas';

/** URL param validation for POST /households/:householdId/pto/mark-paid. */
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

router.post(
  '/pto/mark-paid',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(MarkTimeOffPaidRequestSchema, 'body'),
  asyncHandler(PtoController.markPaid)
);

export default router;
