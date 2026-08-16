/** @module hooks/mutations/useMarkTimesheetViewed — Hours read receipt. Fire-and-forget. */
import type { Timesheet } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { timesheetApi } from '@/src/api/endpoints/timesheets';
import { queryKeys } from '@/src/api/queryKeys';

/**
 * Stamps `parent_viewed_at` the first time the parent week view mounts WITH
 * DATA — the fact behind the nanny Hours timeline's "opened by the household"
 * step. Whether, never how many times: the server ignores every call after
 * the first.
 *
 * NO error toast, deliberately. Nobody pressed anything — this fires off a
 * mount — so a failed read receipt is not a user-visible event, and a toast
 * would report a problem the person reading the hours has no idea about and
 * cannot act on.
 *
 * Only the week query is invalidated: the receipt changes a field ON the
 * row, it does not change WHICH week is on screen.
 */
export function useMarkTimesheetViewed() {
  const queryClient = useQueryClient();

  return useMutation<
    Timesheet,
    Error,
    { timesheetId: string; householdId: string; weekStart: string }
  >({
    mutationFn: ({ timesheetId }) => timesheetApi.markViewed(timesheetId),
    onSuccess: (_viewed, { householdId, weekStart }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.timesheet.week(householdId, weekStart),
      });
    },
  });
}
