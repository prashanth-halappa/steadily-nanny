/** @module hooks/queries/useShiftEvents — shift-scoped day thread. */
import { useQuery } from '@tanstack/react-query';
import { shiftApi } from '@/src/api/endpoints/shifts';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useShiftEvents(
  householdId: string | null | undefined,
  shiftId: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.shift.events(
      householdId ?? undefined,
      shiftId ?? undefined
    ),
    queryFn: () =>
      shiftApi.listEvents(householdId as string, shiftId as string),
    staleTime: QUERY_TIMING.STALE_2M,
    enabled: !!session && isInitialized && !!householdId && !!shiftId,
  });
}
