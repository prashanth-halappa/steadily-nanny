/**
 * Terms-proposal ITEM routes — one proposal, addressed by its id alone.
 * Mounted at `/api/v1/terms-proposals` in `routes/index.ts`.
 *
 * WHY ID-ONLY, WITH NO HOUSEHOLD OR CARER IN THE PATH. The review screen is
 * reached from a push deep link that carries only `data.proposalId` (§13's
 * four types all route there). A household+carer-scoped item route would force
 * the client to resolve the pair before it could ask for the proposal, and §12
 * is explicit that this screen renders from route params rather than showing
 * "a centred spinner on a screen someone opened from a notification about
 * money". The row knows its own household and carer; the service reads them
 * off it and gates against those.
 *
 * NO OWNERSHIP MIDDLEWARE ON ANY ROUTE HERE, AND THAT IS THE POINT —
 * GOLDEN-FIXES #32. `makeOwnershipValidator` caches its answer under
 * `getRelationshipKey(userId, resourceId)` with the LOOKUP's identity absent
 * from the key, so two validators over the same `:proposalId` share one entry,
 * first writer wins, in a module-level process-wide `NodeCache` with a
 * one-hour positive TTL. This resource has exactly the dangerous shape: the
 * GET's read circle (parents plus the carer herself, candidate included) is
 * WIDER than `accept`'s gate (active parents only) and wider than
 * `withdraw`'s (the author only). Mount a wide lookup on the GET and one
 * permitted read would poison the entry every action then short-circuits on —
 * the reproduced failure was a removed parent approving a week.
 * `timesheetRoutes.ts:42-53` registers its own `GET /:id` with no ownership
 * middleware and a comment saying so; this is the same fix, for the same
 * reason. Every gate lives in `termsProposalQueryService.getById` and the
 * command service's `loadForCaller`.
 *
 * Still no PATCH and no DELETE — see the collection router.
 *
 * @module domains/termsProposal/routes/termsProposalItemRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { TermsProposalController } from '../controllers/termsProposalController';
import {
  AcceptTermsProposalRequestSchema,
  TermsProposalIdParamSchema,
} from '../schemas';

const router = Router();

router.get(
  '/:proposalId',
  ...authWithValidation(TermsProposalIdParamSchema, 'params'),
  asyncHandler(TermsProposalController.getById)
);

// §7.3 — the binding act. The body schema's `z.literal(true)` means an
// acceptance without D-7's checkbox never reaches the service at all.
router.post(
  '/:proposalId/accept',
  ...authWithValidation(TermsProposalIdParamSchema, 'params'),
  validate(AcceptTermsProposalRequestSchema, 'body'),
  asyncHandler(TermsProposalController.accept)
);

router.post(
  '/:proposalId/withdraw',
  ...authWithValidation(TermsProposalIdParamSchema, 'params'),
  asyncHandler(TermsProposalController.withdraw)
);

// B4 — the counterparty's refusal. `withdraw` is the author's own exit;
// `decline` is the answer from the side that was asked.
router.post(
  '/:proposalId/decline',
  ...authWithValidation(TermsProposalIdParamSchema, 'params'),
  asyncHandler(TermsProposalController.decline)
);

// WP-G — the author's nudge. No body: there is nothing to say beyond "again",
// and a body would be a place to attach a message this feature deliberately
// does not carry. The 48-hour gate lives in the service, not here.
router.post(
  '/:proposalId/remind',
  ...authWithValidation(TermsProposalIdParamSchema, 'params'),
  asyncHandler(TermsProposalController.remind)
);

// §5.3's one-way "Viewed" receipt — see the controller for why it is a POST
// and not a side effect of the GET above.
router.post(
  '/:proposalId/viewed',
  ...authWithValidation(TermsProposalIdParamSchema, 'params'),
  asyncHandler(TermsProposalController.markViewed)
);

export default router;
