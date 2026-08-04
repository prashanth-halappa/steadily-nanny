/** @module hooks/mutations/useUpdateShift — parent time/note edit (D23). */
import type { ClashWarning } from '@steadily-nanny/shared-types/schemas/me.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  type ParentEditShiftInput,
  shiftApi,
} from '@/src/api/endpoints/shifts';
import { queryKeys } from '@/src/api/queryKeys';
import { requestCalendarSync } from '@/src/domains/schedule/hooks/useCalendarSync';
import { showClashWarningToasts } from '@/src/lib/clashWarningToast';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export type UpdateShiftResult = {
  shift: Shift;
  warnings: ClashWarning[];
};

export function useUpdateShift() {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['errors', 'schedule']);

  return useMutation<
    UpdateShiftResult,
    Error,
    { shiftId: string; input: ParentEditShiftInput }
  >({
    mutationFn: ({ shiftId, input }) => shiftApi.update(shiftId, input),
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.shift.detail(data.shift.id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.me.all });
      showClashWarningToasts(data.warnings, t);
    },
    onSettled: () => {
      requestCalendarSync();
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
