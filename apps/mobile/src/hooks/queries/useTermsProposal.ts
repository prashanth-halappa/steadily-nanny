/** @module hooks/queries/useTermsProposal — one terms proposal, by id. */
import { useQuery } from '@tanstack/react-query';
import { termsProposalApi } from '@/src/api/endpoints/termsProposals';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * One proposal, keyed by ITS ID — what the review screen (§7.2) opens on.
 *
 * By id rather than by (household, carer) because of how that screen is
 * reached: a `terms_proposal_received` push deep link and an inbox row both
 * carry the proposal id and nothing else. The pair comes OFF the row this
 * returns, and every action on it (`useAcceptTerms`, `useCounterTerms`,
 * `useWithdrawTerms`) reads the pair from there.
 *
 * The card this feeds prints `weekly_equivalent_minor` as it arrives from the
 * server. Nothing here or downstream may compute `rate x hours` (D-23, §17).
 */
export function useTermsProposal(proposalId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.termsProposal.detail(proposalId ?? undefined),
    queryFn: () => termsProposalApi.getById(proposalId as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled: !!session && isInitialized && isValidId(proposalId),
  });
}
