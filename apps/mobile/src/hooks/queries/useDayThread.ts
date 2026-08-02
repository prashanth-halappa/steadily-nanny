/** @module hooks/queries/useDayThread — household day-thread events for one local date. */
import { useQuery } from '@tanstack/react-query';
import { shiftApi } from '@/src/api/endpoints/shifts';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useDayThread(
  householdId: string | null | undefined,
  localDate: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.shift.dayThread(
      householdId ?? undefined,
      localDate ?? undefined
    ),
    queryFn: () =>
      shiftApi.listDayThread(householdId as string, localDate as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled:
      !!session &&
      isInitialized &&
      isValidId(householdId) &&
      !!localDate &&
      localDate.length > 0,
  });
}
