/**
 * @module hooks/mutations/useCreateRetroactiveEntry
 *
 * Forgotten clock-in recovery (Today "Add missed hours"). Both ends of the
 * session are supplied up front — there is no running phase — so unlike
 * clock-in/out this mutation has no optimistic cache write: the sheet stays
 * open until the server confirms or refuses (overlap, week already
 * approved, or a span crossing the week boundary all come back as ordinary
 * mutation errors and surface through the generic toast path below).
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
import { showErrorToast, showSuccessToast } from '@/src/lib/toast';

export function useCreateRetroactiveEntry() {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['errors', 'today']);

  return useMutation<TimeEntry, Error, CreateRetroactiveTimeEntryInput>({
    mutationFn: input => timeEntryApi.createRetroactiveEntry(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.timeEntry.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.me.all });
      showSuccessToast(t('today:missedHours.addedToast'));
    },
    onError: error => {
      // Overlap / week-locked / week-crossing refusals all land here as an
      // ordinary conflict — no bespoke copy, same as most other mutations
      // in this domain; the sheet stays open (see the sheet's own submit
      // handler) so nothing typed is lost on a retry.
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
