/** @module hooks/queries/useWeekTimeEntries — a household's clocked entries for one week. */
import { useQuery } from '@tanstack/react-query';
import { timeEntryApi } from '@/src/api/endpoints/timeEntries';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * A household's time entries for the week starting `weekStart` — the
 * household's own first day of the week, `yyyy-mm-dd` (resolve it with
 * `getWeekStartISO`, never assume Monday). Used by both roles: a nanny views
 * her own household's week, a parent views her carer's.
 */
export function useWeekTimeEntries(
  householdId: string | null | undefined,
  weekStart: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.timeEntry.week(
      householdId ?? undefined,
      weekStart ?? undefined
    ),
    queryFn: () =>
      timeEntryApi.listForWeek(householdId as string, weekStart as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled:
      !!session && isInitialized && isValidId(householdId) && !!weekStart,
  });
}
