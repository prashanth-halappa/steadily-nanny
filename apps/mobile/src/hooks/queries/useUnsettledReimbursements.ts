/** @module hooks/queries/useUnsettledReimbursements — approved-but-unsettled weeks for one household. */
import { useQuery } from '@tanstack/react-query';
import { reimbursementSettlementApi } from '@/src/api/endpoints/reimbursementSettlements';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';

export function useUnsettledReimbursements(
  householdId: string | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.reimbursementSettlements.unsettled(householdId),
    queryFn: () =>
      reimbursementSettlementApi.listUnsettled(householdId as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled: enabled && isValidId(householdId),
  });
}
