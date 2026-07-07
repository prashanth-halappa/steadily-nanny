import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  type CreateWidgetInput,
  type Widget,
  widgetApi,
} from '@/src/api/endpoints/widgets';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Create a widget. GATED server-side: a 402 PAYWALL_REQUIRED or 429
 * USAGE_LIMIT_EXCEEDED surfaces here as the upsell path (a localized toast); a
 * 403 additionally engages the global `onForbidden` paywall seam wired in the
 * axios client. On success the list is invalidated so it refetches.
 */
export function useCreateWidget() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<Widget, Error, CreateWidgetInput>({
    mutationFn: widgetApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.widget.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
