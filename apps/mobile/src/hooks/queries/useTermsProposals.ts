/** @module hooks/queries/useTermsProposals — every round of the terms negotiation for one carer in one household. */
import { useQuery } from '@tanstack/react-query';
import { termsProposalApi } from '@/src/api/endpoints/termsProposals';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

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
