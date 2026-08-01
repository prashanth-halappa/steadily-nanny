/** @module hooks/mutations/useClockOut */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ClockOutInput, TimeEntry } from '@/src/api/endpoints/timeEntries';
import { timeEntryApi } from '@/src/api/endpoints/timeEntries';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

interface ClockOutVariables extends ClockOutInput {
  entryId: string;
}

export function useClockOut() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<TimeEntry, Error, ClockOutVariables>({
    mutationFn: ({ entryId, ...input }) =>
      timeEntryApi.clockOut(entryId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.timeEntry.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
