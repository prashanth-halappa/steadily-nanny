import { useQuery } from '@tanstack/react-query';
import { userApi } from '@/src/api/endpoints/user';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/** The signed-in user's household membership rows (all households). */
export function useMyMemberships() {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.user.memberships(),
    queryFn: userApi.listMemberships,
    staleTime: QUERY_TIMING.STALE_5M,
    enabled: !!session && isInitialized,
  });
}
