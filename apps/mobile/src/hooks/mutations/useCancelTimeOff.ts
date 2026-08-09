/** @module hooks/mutations/useCancelTimeOff — soft-cancel a time-off request the caller owns. */
import type { CarerTimeOff } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { timeOffApi } from '@/src/api/endpoints/timeOff';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Cancels a time-off request by id. `DELETE /v1/time-off/:id` is a SOFT
 * cancel (status -> 'cancelled') — the row persists, it is never removed
 * from the list.
 */
export function useCancelTimeOff() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<CarerTimeOff, Error, string>({
    mutationFn: timeOffId => timeOffApi.cancel(timeOffId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.timeOff.all });
      // Busy view unions time_off rows — keep clash checks fresh (D30).
      queryClient.invalidateQueries({ queryKey: queryKeys.availability.all });
      // Cancel on a PAID time off writes reversing `pto_ledger` rows — the
      // carer's "Paid by N families" marker (`usePaidFamilyCounts`) reads
      // those ledgers, so it must refetch (same class as useMarkTimeOffPaid).
      queryClient.invalidateQueries({ queryKey: queryKeys.pto.all });
      // Reversing paid PTO changes the week's `pto` line and gross — every
      // expense mutation hook already invalidates `queryKeys.timesheet.all`
      // for this reason (useMarkTimeOffPaid finding 10); cancel must too.
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
