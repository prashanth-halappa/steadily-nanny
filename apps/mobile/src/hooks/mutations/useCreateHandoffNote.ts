import type {
  CreateHandoffNoteInput,
  HandoffNote,
} from '@steadily-nanny/shared-types/schemas/handoff.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { handoffApi } from '@/src/api/endpoints/handoff';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/** Creates a handoff note for a household day. */
export function useCreateHandoffNote(householdId: string, localDate: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<HandoffNote, Error, CreateHandoffNoteInput>({
    mutationFn: input => handoffApi.create(householdId, input),
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
