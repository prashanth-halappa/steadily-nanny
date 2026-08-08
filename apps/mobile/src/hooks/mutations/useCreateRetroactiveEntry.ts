/**
 * @module hooks/mutations/useCreateRetroactiveEntry
 *
 * Forgotten clock-in recovery (Today "Add missed hours"). Both ends of the
 * session are supplied up front — there is no running phase — so unlike
 * clock-in/out this mutation has no optimistic cache write: the sheet stays
 * open until the server confirms or refuses.
 *
 * The refusals route through the same `assertClockOrder` as a correction
 * (16h cap, finish after start, not in the future) plus the week-approved
 * and week-crossing guards, so they get the same specific copy — see
 * `getTimeEntryEditErrorKey`. Overlap is the one refusal handled by the
 * caller instead: only the sheet knows the household zone needed to name the
 * conflicting entry's day and time range.
 *
 * Invalidation mirrors useClockOut's set (`timeEntry` + `timesheet`) plus
 * `me` — the carer's own cross-household reads can include this week too.
 */
import type { CreateRetroactiveTimeEntryInput } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TimeEntry } from '@/src/api/endpoints/timeEntries';
import { timeEntryApi } from '@/src/api/endpoints/timeEntries';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { useIsOnline } from '@/src/lib/network';
import { showErrorToast, showSuccessToast } from '@/src/lib/toast';
import {
  getClockMutationErrorKey,
  getTimeEntryEditErrorKey,
} from './timeEntryMutationUtils';

export function useCreateRetroactiveEntry() {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['errors', 'today']);
  const isOnline = useIsOnline();

  return useMutation<TimeEntry, Error, CreateRetroactiveTimeEntryInput>({
    mutationFn: input => timeEntryApi.createRetroactiveEntry(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.timeEntry.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.me.all });
      showSuccessToast(t('today:missedHours.addedToast'));
    },
    onError: error => {
      // Week-locked / bad-times / 16h-cap / week-crossing refusals each get
      // their own copy, exactly as in useUpdateTimeEntry — the hours she is
      // typing are her pay, so "check the information you entered" is not an
      // answer. The sheet stays open (see the sheet's own submit handler) so
      // nothing typed is lost on a retry.
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
