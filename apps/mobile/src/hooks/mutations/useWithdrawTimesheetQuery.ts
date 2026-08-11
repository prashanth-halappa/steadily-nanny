/** @module hooks/mutations/useWithdrawTimesheetQuery — the parent takes the question back (D-19). */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Timesheet } from '@/src/api/endpoints/timesheets';
import { timesheetApi } from '@/src/api/endpoints/timesheets';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

interface WithdrawTimesheetQueryVariables {
  timesheetId: string;
}

/**
 * `queried` -> `submitted`. Parents only, enforced server-side.
 *
 * Invalidates the whole timesheet tree because the STATUS moved, and the
 * card's tone, its headline and the thread composer's visibility are all
 * derived from it — plus the thread itself, which gains a
 * `query_withdrawn` message rather than being cleared (that second sentence
 * of the confirm dialog is load-bearing).
 */
export function useWithdrawTimesheetQuery() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<Timesheet, Error, WithdrawTimesheetQueryVariables>({
    mutationFn: ({ timesheetId }) => timesheetApi.withdrawQuery(timesheetId),
    onSuccess: (_timesheet, { timesheetId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.timesheet.thread(timesheetId),
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}

export type { WithdrawTimesheetQueryVariables };
