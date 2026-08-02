/** @module hooks/queries/useRunningTimeEntry — the caller's open clock-in, if any. */
import { useQuery } from '@tanstack/react-query';
import { timeEntryApi } from '@/src/api/endpoints/timeEntries';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * The caller's currently-running time entry, or `null` if not clocked in.
 * Short `staleTime`: the running state can change from another device (a
 * clock-out elsewhere) — or simply from backgrounding and foregrounding this
 * one, since the Tabs navigator keeps the Today screen mounted across a
 * resume and `refetchOnMount` never fires — and the Today clock-in card
 * should reflect that promptly rather than showing a stale "still running"
 * state indefinitely (D17). The 30s `staleTime` here plus the app-wide
 * `refetchOnWindowFocus: true` (queryClient.ts) is what makes an app resume
 * actually revalidate this query rather than just sit on cached data.
 */
export function useRunningTimeEntry() {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.timeEntry.running(),
    queryFn: timeEntryApi.getRunning,
    staleTime: QUERY_TIMING.STALE_30S,
    enabled: !!session && isInitialized,
  });
}
