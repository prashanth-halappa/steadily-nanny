/**
 * @module hooks/queries/useMeShifts
 *
 * Cross-household carer shift feed — GET /me/shifts. Prefer this over N
 * parallel household range queries when the caller only needs their own
 * assigned shifts (e.g. CrossFamilyRhythmView).
 */
import { useQuery } from '@tanstack/react-query';
import { meApi } from '@/src/api/endpoints/me';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useMeShifts(from: string | undefined, to: string | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);
  const enabled = !!session && isInitialized && !!from && !!to;

  return useQuery({
    queryKey: queryKeys.me.shifts(from, to),
    queryFn: () => meApi.listShifts(from as string, to as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled,
  });
}
