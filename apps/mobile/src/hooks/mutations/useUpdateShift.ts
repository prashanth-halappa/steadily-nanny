/** @module hooks/mutations/useUpdateShift — parent time/note edit (D23). */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  type ParentEditShiftInput,
  shiftApi,
} from '@/src/api/endpoints/shifts';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export function useUpdateShift() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<
    Shift,
    Error,
    { shiftId: string; input: ParentEditShiftInput }
  >({
    mutationFn: ({ shiftId, input }) => shiftApi.update(shiftId, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.shift.detail(vars.shiftId),
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
