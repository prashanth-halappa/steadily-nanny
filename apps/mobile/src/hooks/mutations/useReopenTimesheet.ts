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
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
