/** @module hooks/queries/useWeekExpenses — every expense/mileage row for one household-local week. */
import { useQuery } from '@tanstack/react-query';
import { expenseApi } from '@/src/api/endpoints/expenses';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * All of a household's expense/mileage rows for one week — every status
 * (pending/approved/rejected), so the nanny's own list (TIER0-CX-SPEC.md
 * §6.1) can render status chips and rejection reasons. Filtering to
 * approved-only for the statement's Reimbursements card (§6.3) happens at
 * the call site, not here.
 */
export function useWeekExpenses(
  householdId: string | null | undefined,
  weekStart: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.expenses.week(
      householdId ?? undefined,
      weekStart ?? undefined
    ),
    queryFn: () =>
      expenseApi.listForWeek(householdId as string, weekStart as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled:
      !!session && isInitialized && isValidId(householdId) && !!weekStart,
  });
}
