import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type Widget, widgetApi } from '@/src/api/endpoints/widgets';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Generate an AI description + tags for a widget (GATED by llm_generation). On
 * success the returned widget is written into the detail cache and the list is
 * invalidated. The server degrades gracefully, so this rarely errors.
 */
export function useGenerateWidgetDescription(widgetId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<Widget, Error, void>({
    mutationFn: () => widgetApi.generateDescription(widgetId),
    onSuccess: updated => {
      queryClient.setQueryData(queryKeys.widget.byId(widgetId), updated);
      queryClient.invalidateQueries({ queryKey: queryKeys.widget.list() });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
