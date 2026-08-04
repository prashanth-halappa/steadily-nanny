/** @module hooks/queries/useNotificationPrefs — GET /notifications/prefs. */
import { useQuery } from '@tanstack/react-query';
import { notificationsApi } from '@/src/api/endpoints/notifications';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/** Caller's push preferences (defaults when no prefs row exists). */
export function useNotificationPrefs() {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.notifications.prefs(),
    queryFn: () => notificationsApi.getPrefs(),
    staleTime: QUERY_TIMING.STALE_15M,
    gcTime: QUERY_TIMING.GC_30M,
    enabled: !!session && isInitialized,
  });
}
