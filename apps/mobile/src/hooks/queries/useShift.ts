/** @module hooks/queries/useShift — one materialised shift by id. */
import { useQuery } from '@tanstack/react-query';
import { shiftApi } from '@/src/api/endpoints/shifts';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useShift(shiftId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.shift.detail(shiftId ?? undefined),
    queryFn: () => shiftApi.getById(shiftId as string),
    staleTime: QUERY_TIMING.STALE_2M,
    enabled: !!session && isInitialized && !!shiftId,
  });
}
