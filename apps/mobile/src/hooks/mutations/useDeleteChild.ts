import type { Child } from '@steadily-nanny/shared-types/schemas/child.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { childrenApi } from '@/src/api/endpoints/children';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/** Archives (soft-deletes) a child. */
export function useDeleteChild(householdId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<Child, Error, string>({
    mutationFn: childId => childrenApi.remove(householdId, childId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.children.list(householdId),
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
