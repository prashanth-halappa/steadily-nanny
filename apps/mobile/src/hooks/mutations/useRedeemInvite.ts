import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';
import { useSetupProgressStore } from '@/src/store/setupProgress';

export interface RedeemInviteVariables {
  code: string;
  /**
   * D-34 absorption target (§8.2): set only when a parent who already has a
   * live household is redeeming a NANNY'S draft code, so she joins THEIR
   * family rather than them joining her draft. The confirm sheet is what
   * chooses it; nothing else may.
   */
  targetHouseholdId?: string;
  /**
   * D-8: the FLSA workweek for a household the server INSTANTIATES from a
   * nanny's draft (096). Device-derived by the caller, read only on that one
   * path, and never a change to a household that already exists.
   */
  weekStartsOn?: number;
}

/**
 * Redeems a household invite code — creates the caller's membership row.
 * Caches the resulting household id on `setupProgress` for the availability
 * step and beyond.
 */
export function useRedeemInvite() {
  const queryClient = useQueryClient();
  const setHouseholdId = useSetupProgressStore(s => s.setHouseholdId);
  const { t } = useTranslation('errors');

  return useMutation<HouseholdMember, Error, RedeemInviteVariables>({
    mutationFn: ({ code, targetHouseholdId, weekStartsOn }) =>
      householdApi.redeemInvite(code, targetHouseholdId, weekStartsOn),
    onSuccess: membership => {
      setHouseholdId(membership.household_id);
      // Defer invalidation so `CodeEntryScreen` can persist role/step and
      // navigate BEFORE `useIsOnboarded` refetches. An immediate invalidate
      // flips the onboarding layout to `loading`, unmounts the wizard Stack,
      // and remounts CODE with empty local state while the invite is gone.
      queueMicrotask(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.household.all });
        queryClient.invalidateQueries({
          queryKey: queryKeys.user.memberships(),
        });
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
