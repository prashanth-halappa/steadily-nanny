import type {
  Child,
  UpdateChildInput,
} from '@steadily-nanny/shared-types/schemas/child.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { childrenApi } from '@/src/api/endpoints/children';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

interface UpdateChildVariables {
  childId: string;
  input: UpdateChildInput;
}

/** Updates a child's fields (name, birth date, colour, routine notes). */
export function useUpdateChild(householdId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<Child, Error, UpdateChildVariables>({
    mutationFn: ({ childId, input }) =>
      childrenApi.update(householdId, childId, input),
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
