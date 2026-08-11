/**
 * Terms-proposal COLLECTION routes — routing + middleware wiring only.
 * Mounted at `/api/v1/households/:householdId/carers/:carerId/terms-proposals`
 * in `routes/index.ts`, alongside the pay-arrangement router it feeds.
 *
 * WHY THE DOMAIN HAS TWO ROUTERS. Creating and listing are scoped by the pair
 * — a proposal concerns exactly one carer, and a household with two nannies
 * has two independent negotiations neither may see (D-21) — so the collection
 * lives under the carer, exactly as `payArrangementRoutes` does. Acting on ONE
 * proposal is scoped by its id alone, in `termsProposalItemRoutes.ts`; that
 * file's header explains why, and it is a deep-link requirement rather than a
 * style choice.
 *
 * THERE IS NO PATCH AND NO DELETE, and that is the feature. `terms_proposals`
 * is append-only: a counter is a POST of a NEW row naming the one it answers
 * (`supersedes_id`), and a withdrawal is a status change that leaves the row
 * in the history. Immutability in this stack is the ABSENCE of a write path,
 * so adding either verb here would quietly undo §7.2's "How we got here".
 *
 * `authWithValidation`, NEVER `authWithOwnership` — GOLDEN-FIXES #32; see the
 * item router and `utils/proposalAccess.ts` for the full reasoning. Every
 * check lives at the top of the relevant service method.
 *
 * @module domains/termsProposal/routes/termsProposalRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { TermsProposalController } from '../controllers/termsProposalController';
import {
  CreateTermsProposalRequestSchema,
  HouseholdCarerParamSchema,
} from '../schemas';

// mergeParams so `:householdId`/`:carerId` from the parent mount are visible
// on req.params (and therefore validatable by HouseholdCarerParamSchema).
const router = Router({ mergeParams: true });

router.get(
  '/current',
  ...authWithValidation(HouseholdCarerParamSchema, 'params'),
  asyncHandler(TermsProposalController.getCurrent)
);

router.get(
  '/',
  ...authWithValidation(HouseholdCarerParamSchema, 'params'),
  asyncHandler(TermsProposalController.list)
);

router.post(
  '/',
  ...authWithValidation(HouseholdCarerParamSchema, 'params'),
  validate(CreateTermsProposalRequestSchema, 'body'),
  asyncHandler(TermsProposalController.create)
);

export default router;
