/** @module hooks/mutations/useReopenTimesheet — undo for approve (parents only). */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Timesheet } from '@/src/api/endpoints/timesheets';
import { timesheetApi } from '@/src/api/endpoints/timesheets';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

interface ReopenTimesheetVariables {
  timesheetId: string;
  reason: string;
}

/**
 * The 409 that migration 102 raises when a week already has payment rows.
 * `TimesheetNotActionableError` puts its label in `metadata.status`, not
 * `metadata.reason` — that class is reused rather than a second one invented.
 *
 * `ReopenWeekDialog` states this one inline, so the toast below is skipped
 * for it: a toast over an open `BottomSheetBase` is invisible anyway
 * (GOLDEN-FIXES #40), and reporting one refusal twice is worse than once.
 */
export function isPaidWeekReopenRefusal(error: unknown): boolean {
  const err = (error ?? {}) as {
    response?: {
      status?: number;
      data?: { error?: { metadata?: { status?: string } } };
    };
  };
  return (
    err.response?.status === 409 &&
    err.response.data?.error?.metadata?.status === 'has_payments'
  );
}

export function useReopenTimesheet() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<Timesheet, Error, ReopenTimesheetVariables>({
    mutationFn: ({ timesheetId, reason }) =>
      timesheetApi.reopen(timesheetId, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: error => {
      if (isPaidWeekReopenRefusal(error)) return;
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
