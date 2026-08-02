import type {
  HandoffNote,
  UpdateHandoffNoteInput,
} from '@steadily-nanny/shared-types/schemas/handoff.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { handoffApi } from '@/src/api/endpoints/handoff';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/** Updates a handoff note (chips, body, save_moment). */
export function useUpdateHandoffNote(householdId: string, localDate: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<
    HandoffNote,
    Error,
    { handoffNoteId: string; input: UpdateHandoffNoteInput }
  >({
    mutationFn: ({ handoffNoteId, input }) =>
      handoffApi.update(handoffNoteId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.handoff.list(householdId, localDate),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.handoff.recap(householdId, localDate),
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
