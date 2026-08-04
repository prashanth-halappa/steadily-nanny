/** @module hooks/mutations/useDeleteHouseholdClosure — hard-delete a household closure. Owner/parent only. */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { householdClosureApi } from '@/src/api/endpoints/householdClosures';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/** Hard-deletes a closure by id — unlike time off, there is no soft-cancel. */
export function useDeleteHouseholdClosure(householdId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<void, Error, string>({
    mutationFn: closureId => householdClosureApi.remove(householdId, closureId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.householdClosures.list(householdId),
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
