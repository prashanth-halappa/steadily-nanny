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
    mutationFn: ({ code, targetHouseholdId }) =>
      householdApi.redeemInvite(code, targetHouseholdId),
    onSuccess: membership => {
      setHouseholdId(membership.household_id);
      queryClient.invalidateQueries({ queryKey: queryKeys.household.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.user.memberships() });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
