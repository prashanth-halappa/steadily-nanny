/** @module hooks/queries/useAvailabilityForCarer — another carer's weekly availability. */
import { useQuery } from '@tanstack/react-query';
import { availabilityApi } from '@/src/api/endpoints/availability';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * A specific carer's weekly availability — for a parent building or
 * reviewing a schedule with them (D25). Distinct from `useAvailability`,
 * which is the self-view (`GET /availability/me`) a nanny uses on her own
 * availability screen; this hook backs `GET /availability/:userId`, gated
 * server-side on an active shared household.
 */
export function useAvailabilityForCarer(userId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.availability.forUser(userId ?? undefined),
    queryFn: () => availabilityApi.getForUser(userId as string),
    staleTime: QUERY_TIMING.STALE_2M,
    enabled: !!session && isInitialized && !!userId,
  });
}
