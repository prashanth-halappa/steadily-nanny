/** @module hooks/queries/useTimesheetThread — what was said about one week (D-18). */
import { useQuery } from '@tanstack/react-query';
import { timesheetApi } from '@/src/api/endpoints/timesheets';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * One week's message thread, oldest first. Any active household member may
 * read it — both sides always see every message
 * (`docs/design/attention-and-notifications.md` §3), so there is no viewer
 * fork here or anywhere downstream.
 *
 * `null` until the week's timesheet row exists (nothing clocked out yet),
 * which is also a week nobody can have said anything about.
 */
export function useTimesheetThread(timesheetId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.timesheet.thread(timesheetId ?? undefined),
    queryFn: () => timesheetApi.getThread(timesheetId as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled: !!session && isInitialized && isValidId(timesheetId),
  });
}
