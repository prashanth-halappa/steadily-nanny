/**
 * @module hooks/mutations/useClockOut
 *
 * Optimistic clock-out clears the running-entry cache via onMutate so the
 * Today card reflects "clocked out" immediately, including while offline
 * (the mutation pauses until reconnect and then retries). Residual
 * limitation: if the app process is killed before the paused mutation
 * completes, the queued clock-out is lost — there is no persistence layer
 * (Wave 2I / G20).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ClockOutInput, TimeEntry } from '@/src/api/endpoints/timeEntries';
import { timeEntryApi } from '@/src/api/endpoints/timeEntries';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { useIsOnline } from '@/src/lib/network';
import { showErrorToast } from '@/src/lib/toast';
import {
  clockMutationRetry,
  getClockMutationErrorKey,
  isClockOutConflictError,
} from './timeEntryMutationUtils';

interface ClockOutVariables extends ClockOutInput {
  entryId: string;
}

interface ClockOutMutationContext {
  previous: TimeEntry | null | undefined;
}

export function useClockOut() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');
  const isOnline = useIsOnline();

  return useMutation<
    TimeEntry,
    Error,
    ClockOutVariables,
    ClockOutMutationContext
  >({
    mutationFn: ({ entryId, ...input }) =>
      timeEntryApi.clockOut(entryId, input),
    networkMode: 'online',
    retry: clockMutationRetry,
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.timeEntry.running(),
      });
      const previous = queryClient.getQueryData<TimeEntry | null>(
        queryKeys.timeEntry.running()
      );
      queryClient.setQueryData(queryKeys.timeEntry.running(), null);
      if (!isOnline) {
        showErrorToast(
          getLocalizedErrorMessage({ isAxiosError: true }, t, 'errors:offline')
        );
      }
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.timeEntry.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: (error, _variables, context) => {
      if (isClockOutConflictError(error)) {
        queryClient.invalidateQueries({ queryKey: queryKeys.timeEntry.all });
      } else if (context?.previous !== undefined) {
        queryClient.setQueryData(
          queryKeys.timeEntry.running(),
          context.previous
        );
      }
      showErrorToast(
        getLocalizedErrorMessage(
          error,
          t,
          getClockMutationErrorKey(error, isOnline)
        )
      );
    },
  });
}
