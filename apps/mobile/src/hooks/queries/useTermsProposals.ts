/** @module hooks/queries/useTermsProposals — every round of the terms negotiation for one carer in one household. */

import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { OPEN_TERMS_PROPOSAL_STATUSES } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { useQuery } from '@tanstack/react-query';
import { termsProposalApi } from '@/src/api/endpoints/termsProposals';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * The live negotiation, if any — status ∈ OPEN_TERMS_PROPOSAL_STATUSES.
 * Shared by PayArrangementScreen and PaySetupPromptCard so the "open"
 * predicate stays one place (defect B2).
 */
export function findOpenTermsProposal(
  proposals: readonly TermsProposal[] | null | undefined
): TermsProposal | undefined {
  return (proposals ?? []).find(row =>
    (OPEN_TERMS_PROPOSAL_STATUSES as readonly string[]).includes(row.status)
  );
}

/**
 * The whole chain for one (household, carer) pair, newest first — §7.2's "How
 * we got here". Every counter is a new row pointing at the one it answered
 * (`supersedes_id`), so this list is a true history, not a UI convenience.
 */
export function useTermsProposals(
  householdId: string | null | undefined,
  carerId: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.termsProposal.list(
      householdId ?? undefined,
      carerId ?? undefined
    ),
    queryFn: () =>
      termsProposalApi.list(householdId as string, carerId as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled:
      !!session &&
      isInitialized &&
      isValidId(householdId) &&
      isValidId(carerId),
  });
}
