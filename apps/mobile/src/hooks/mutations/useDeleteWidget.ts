import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { widgetApi } from '@/src/api/endpoints/widgets';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Delete a widget by id. On success the list is invalidated so the deleted item
 * disappears.
 */
export function useDeleteWidget() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<void, Error, string>({
    mutationFn: (widgetId: string) => widgetApi.remove(widgetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.widget.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
