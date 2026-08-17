import type {
  CreateHouseholdInput,
  Household,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';
import { useSetupProgressStore } from '@/src/store/setupProgress';

/**
 * Creates a household — the caller becomes its owner. Used as the first step
 * of the parent setup flow (a household must exist before children/invites).
 * Caches the resulting id on `setupProgress` so later steps don't need to
 * refetch the households list just to find it.
 */
export function useCreateHousehold() {
  const queryClient = useQueryClient();
  const setHouseholdId = useSetupProgressStore(s => s.setHouseholdId);
  const { t } = useTranslation('errors');

  return useMutation<Household, Error, CreateHouseholdInput>({
    mutationFn: input => householdApi.create(input),
    onSuccess: household => {
      setHouseholdId(household.id);
      // P4.1 — seed the list this response already answers, so every
      // household-scoped query gated on `useActiveHousehold` (children,
      // members, timesheets…) can enable on THIS tick instead of waiting for
      // a second round trip to refetch `list()` themselves. Append rather
      // than replace: a stale cached list is still every OTHER household the
      // caller belongs to. Invalidate too — the seed is a best-effort first
      // paint, the refetch is what makes it correct.
      queryClient.setQueryData<Household[]>(queryKeys.household.list(), old =>
        old ? [...old, household] : [household]
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.household.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
