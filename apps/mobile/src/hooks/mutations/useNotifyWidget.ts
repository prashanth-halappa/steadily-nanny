import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type SendResult, widgetApi } from '@/src/api/endpoints/widgets';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast, showSuccessToast } from '@/src/lib/toast';

/**
 * Trigger a "widget ready" push to the caller's own registered devices. The push
 * payload deep-links back to this widget's detail screen (see the push routeMap).
 */
export function useNotifyWidget(widgetId: string) {
  const { t } = useTranslation('errors');

  return useMutation<SendResult, Error, void>({
    mutationFn: () => widgetApi.notify(widgetId),
    onSuccess: result => {
      // TEMPLATE: inline English — consider i18n for a real feature.
      showSuccessToast(`Push sent to ${result.sent} device(s).`);
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
