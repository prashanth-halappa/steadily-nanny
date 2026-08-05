/** @module hooks/queries/usePendingExpenses — every still-pending expense/mileage row for a household, across all weeks. */
import { useQuery } from '@tanstack/react-query';
import { expenseApi } from '@/src/api/endpoints/expenses';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * The parent's "N expenses to review" affordance (TIER0-CX-SPEC.md §6.2):
 * every `pending` row for the household, regardless of which week it falls
 * in. Any active member may read (RLS is select-only, "parents/owners plus
 * the carer reading her own rows"), but only a parent ever opens the review
 * sheet this backs.
 */
export function usePendingExpenses(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.expenses.pending(householdId ?? undefined),
    queryFn: () => expenseApi.listPending(householdId as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled: !!session && isInitialized && isValidId(householdId),
  });
}
