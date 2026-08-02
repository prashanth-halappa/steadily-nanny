import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { commitmentApi } from '@/src/api/endpoints/commitments';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/** Hard-deletes a child commitment. */
export function useDeleteCommitment(householdId: string, childId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<void, Error, string>({
    mutationFn: commitmentId => commitmentApi.remove(commitmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.commitments.list(householdId, childId),
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
