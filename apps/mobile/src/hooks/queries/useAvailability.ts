import { useQuery } from '@tanstack/react-query';
import { availabilityApi } from '@/src/api/endpoints/availability';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/** The signed-in nanny's own weekday availability rows. */
export function useAvailability() {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.availability.mine(),
    queryFn: availabilityApi.getMine,
    staleTime: QUERY_TIMING.STALE_2M,
    enabled: !!session && isInitialized,
  });
}
