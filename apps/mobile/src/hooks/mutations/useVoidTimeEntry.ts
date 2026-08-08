/**
 * @module hooks/mutations/useVoidTimeEntry
 *
 * The carer's soft-delete of a time entry (069). Deliberately NOT optimistic
 * for the same reason as `useUpdateTimeEntry` — the server may refuse.
 *
 * Refusals render inline in the correction sheet, not via toast — a
 * `BottomSheetBase` is already an RN `<Modal>`, and toasting over it is not
 * reliable on iOS (GOLDEN-FIXES #40).
 */
import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type { TimeEntry } from '@/src/api/endpoints/timeEntries';
import { timeEntryApi } from '@/src/api/endpoints/timeEntries';
import { queryKeys } from '@/src/api/queryKeys';
import { clockMutationRetry } from './timeEntryMutationUtils';

export interface VoidTimeEntryVariables {
  entryId: string;
}

export function useVoidTimeEntry(): UseMutationResult<
  TimeEntry,
  Error,
  VoidTimeEntryVariables
> {
  const queryClient = useQueryClient();

  return useMutation<TimeEntry, Error, VoidTimeEntryVariables>({
    mutationFn: ({ entryId }) => timeEntryApi.void(entryId),
    networkMode: 'online',
    retry: clockMutationRetry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.timeEntry.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: () => {
      // Same stale-offer class as `useUpdateTimeEntry` — refetch so the row
      // stops offering void when the server has already voided or locked it.
      queryClient.invalidateQueries({ queryKey: queryKeys.timeEntry.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
  });
}
