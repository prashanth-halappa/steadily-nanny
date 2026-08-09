/** @module hooks/mutations/useCreatePayArrangement — record a new pay arrangement. Parents only. */
import type {
  CreatePayArrangementRequest,
  PayArrangement,
} from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { payArrangementApi } from '@/src/api/endpoints/payArrangements';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Creates a new pay arrangement for one (household, carer) pair. The table
 * is append-only (docs/11-MONEY.md §2/§3) — this is the only write in the
 * domain. A non-parent gets a 403 (`errors:forbidden`) server-side.
 *
 * On success, invalidates BOTH the current-arrangement and history caches
 * for this pair: a new row changes what "current" resolves to AND appends
 * to the history list.
 */
export function useCreatePayArrangement(householdId: string, carerId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<PayArrangement, Error, CreatePayArrangementRequest>({
    mutationFn: input => payArrangementApi.create(householdId, carerId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.pay.current(householdId, carerId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.pay.history(householdId, carerId),
      });
      // A new arrangement can flip a week's earnings status (e.g. currency_change → ok).
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
