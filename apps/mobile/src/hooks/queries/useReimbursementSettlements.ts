/** @module hooks/queries/useReimbursementSettlements — the "we paid her back" records for one household-local week. */
import { useQuery } from '@tanstack/react-query';
import { reimbursementSettlementApi } from '@/src/api/endpoints/reimbursementSettlements';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * Every reimbursement settlement recorded against one week (D-14). A list,
 * not a row — a two-carer household settles two — so picking the one that
 * belongs to the carer on screen happens at the call site.
 *
 * NOT the payment ledger, and never merged with it: a settlement is the
 * family repaying money she already spent, not wages
 * (reimbursementSettlement.schema.ts).
 */
export function useReimbursementSettlements(
  householdId: string | null | undefined,
  weekStart: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.reimbursementSettlements.week(
      householdId ?? undefined,
      weekStart ?? undefined
    ),
    queryFn: () =>
      reimbursementSettlementApi.listForWeek(
        householdId as string,
        weekStart as string
      ),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled:
      !!session && isInitialized && isValidId(householdId) && !!weekStart,
  });
}
