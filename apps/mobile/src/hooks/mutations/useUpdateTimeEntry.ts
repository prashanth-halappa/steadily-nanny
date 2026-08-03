/**
 * @module hooks/mutations/useUpdateTimeEntry
 *
 * The carer's correction of an already-clocked-out entry (Daylight UX P0-2).
 *
 * Deliberately NOT optimistic, unlike `useClockOut`. A clock-out is a
 * physical act the carer just performed, so showing it immediately is
 * honest; a correction is a claim about a pay record the server may refuse
 * — the week may have been approved a second ago on the parent's phone.
 * Painting the new figure before the server accepts it would show a number
 * that is not the recorded one, which is the exact failure P0-2 exists to
 * end.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  TimeEntry,
  UpdateTimeEntryInput,
} from '@/src/api/endpoints/timeEntries';
import { timeEntryApi } from '@/src/api/endpoints/timeEntries';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { useIsOnline } from '@/src/lib/network';
import { showErrorToast } from '@/src/lib/toast';
import {
  clockMutationRetry,
  getClockMutationErrorKey,
  getTimeEntryEditErrorKey,
} from './timeEntryMutationUtils';

interface UpdateTimeEntryVariables extends UpdateTimeEntryInput {
  entryId: string;
}

export function useUpdateTimeEntry() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');
  const isOnline = useIsOnline();

  return useMutation<TimeEntry, Error, UpdateTimeEntryVariables>({
    mutationFn: ({ entryId, ...input }) => timeEntryApi.update(entryId, input),
    networkMode: 'online',
    retry: clockMutationRetry,
    onSuccess: () => {
      // The week total is server-derived (`rollUpIntoTimesheet` re-sums the
      // week rather than adjusting a stored figure), so the timesheet must
      // be refetched alongside the entries — a corrected entry changes both.
      queryClient.invalidateQueries({ queryKey: queryKeys.timeEntry.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: error => {
      // A 409 means the week was approved (or the entry closed) between
      // opening the sheet and confirming — refetch so the row stops
      // offering an edit that can no longer happen.
      queryClient.invalidateQueries({ queryKey: queryKeys.timeEntry.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
      showErrorToast(
        getLocalizedErrorMessage(
          error,
          t,
          getClockMutationErrorKey(
            error,
            isOnline,
            getTimeEntryEditErrorKey(error)
          )
        )
      );
    },
  });
}
