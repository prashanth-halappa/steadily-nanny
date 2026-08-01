/** @module hooks/mutations/useApproveTimesheet — one-tap weekly approval (parents only). */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Timesheet } from '@/src/api/endpoints/timesheets';
import { timesheetApi } from '@/src/api/endpoints/timesheets';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export function useApproveTimesheet() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<Timesheet, Error, string>({
    mutationFn: timesheetId => timesheetApi.approve(timesheetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
