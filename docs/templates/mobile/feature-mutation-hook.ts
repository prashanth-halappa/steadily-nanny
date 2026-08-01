/**
 * Mutation hook skeleton — write server state for `<feature>`.
 * Lives at: apps/mobile/src/hooks/mutations/useCreate<Feature>.ts
 *
 * Wraps the endpoint create call in TanStack Query's useMutation. On success it
 * invalidates the relevant query keys so the list refetches. On error it surfaces a
 * localized toast. Components call `mutate(input)` and read `isPending` — they never
 * touch the endpoint module directly.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { widgetApi } from '../../api/endpoints/widgets';
import { queryKeys } from '../../api/queryKeys';
import { getLocalizedErrorMessage, showErrorToast } from '../../lib/toast';
import type { CreateWidgetInput, Widget } from '@steadily-nanny/shared-types/schemas/widget.schema';

export function useCreateWidget() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<Widget, Error, CreateWidgetInput>({
    mutationFn: widgetApi.create,
    onSuccess: () => {
      // Invalidate the list so it refetches with the new item.
      queryClient.invalidateQueries({ queryKey: queryKeys.widget.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t, 'createWidget'));
    },
  });
}
