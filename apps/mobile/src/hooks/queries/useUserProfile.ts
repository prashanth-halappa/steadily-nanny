import { useQuery } from '@tanstack/react-query';
import { userApi } from '@/src/api/endpoints/user';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * The authenticated user's profile. Gated on an initialized session so it never
 * fires tokenless.
 */
export function useUserProfile() {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);
  const userId = session?.user?.id;

  return useQuery({
    queryKey: queryKeys.user.profile(userId),
    queryFn: userApi.getProfile,
    staleTime: QUERY_TIMING.STALE_15M,
    gcTime: QUERY_TIMING.GC_30M,
    enabled: !!session && isInitialized,
  });
}
