/**
 * @module app/(private)/pay/proposal/[id]
 *
 * Route: `/pay/proposal/:id` — the terms-proposal review
 * (`docs/design/screens-onboarding-terms-proposal.md` §7.2). Reached from
 * Settings → Pay, the Today card, the inbox row, and the
 * `terms_proposal_received` / `terms_proposal_countered` /
 * `terms_proposal_withdrawn` pushes. See
 * `src/domains/pay/components/ProposalReviewScreen` for the implementation.
 */
import { ProposalReviewScreen } from '@/src/domains/pay/components/ProposalReviewScreen';

export default function ProposalReviewRoute() {
  return <ProposalReviewScreen />;
}
