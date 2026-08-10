/** @module hooks/mutations/useApproveTimesheet — weekly approval (parents only). */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Timesheet } from '@/src/api/endpoints/timesheets';
import { timesheetApi } from '@/src/api/endpoints/timesheets';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

interface ApproveTimesheetVariables {
  timesheetId: string;
  /** The parent's staged approval-time adjustment, folded into the frozen
   * snapshot server-side. Absent/null approves the computed total. */
  adjustment?: { amount_minor: number; note: string } | null;
}

export function useApproveTimesheet() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<Timesheet, Error, ApproveTimesheetVariables>({
    // No adjustment posts NO body — the exact pre-adjustment call, so an
    // approval that carries nothing extra is byte-identical on the wire.
    mutationFn: ({ timesheetId, adjustment }) =>
      adjustment
        ? timesheetApi.approve(timesheetId, { adjustment })
        : timesheetApi.approve(timesheetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}

export type { ApproveTimesheetVariables };
