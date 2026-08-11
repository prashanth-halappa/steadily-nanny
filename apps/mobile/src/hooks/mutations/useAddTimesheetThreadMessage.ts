/** @module hooks/mutations/useAddTimesheetThreadMessage — one message on the week thread (D-18). */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TimesheetThread } from '@/src/api/endpoints/timesheets';
import { timesheetApi } from '@/src/api/endpoints/timesheets';
import { queryKeys } from '@/src/api/queryKeys';

interface AddTimesheetThreadMessageVariables {
  timesheetId: string;
  message: string;
}

/**
 * Posts a reply — or a nanny OPENING a thread on a week nobody queried
 * (§3.1) — and seeds the cache with the full thread the server answers with.
 *
 * No toast on either leg, deliberately. Success is confirmed by the message
 * appearing in the thread with her name and a timestamp — §3.1 is explicit
 * that there is no "your dispute has been filed" — and a failure is stated
 * inline under the composer, because this composer can sit under an open
 * sheet where a toast is not visible at all (GOLDEN-FIXES #40). The caller
 * reads `error`.
 *
 * The week's STATUS is untouched by a message, so nothing else invalidates.
 */
export function useAddTimesheetThreadMessage() {
  const queryClient = useQueryClient();

  return useMutation<
    TimesheetThread,
    Error,
    AddTimesheetThreadMessageVariables
  >({
    mutationFn: ({ timesheetId, message }) =>
      timesheetApi.addThreadMessage(timesheetId, { message }),
    onSuccess: (thread, { timesheetId }) => {
      queryClient.setQueryData(queryKeys.timesheet.thread(timesheetId), thread);
    },
  });
}

export type { AddTimesheetThreadMessageVariables };
