/** @module hooks/queries/useBusyBlocks — anonymised busy spans for a carer + range. */
import { useQuery } from '@tanstack/react-query';
import { availabilityApi } from '@/src/api/endpoints/availability';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * Cross-household anonymised busy blocks for `carerId` in `[from, to]`.
 * Used by the time-off request flow (D30) so a nanny can warn before
 * booking over a confirmed shift. Enabled only when auth is ready and
 * carer + both range bounds are present.
 */
export function useBusyBlocks(
  carerId: string | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);
  const hasRange = !!carerId && !!from && !!to;

  return useQuery({
    queryKey: queryKeys.availability.busy(
      carerId ?? undefined,
      from ?? undefined,
      to ?? undefined
    ),
    queryFn: () =>
      availabilityApi.getBusyBlocks(
        carerId as string,
        from as string,
        to as string
      ),
    staleTime: QUERY_TIMING.STALE_2M,
    enabled: !!session && isInitialized && hasRange,
  });
}
