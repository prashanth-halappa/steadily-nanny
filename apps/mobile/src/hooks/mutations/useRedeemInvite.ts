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
  /**
   * §8.2c "join & close" (`HouseholdDecisionSheet`): a parent who already
   * owns a live household picked the destructive option over the escape
   * hatch. Set only by that sheet's confirm — the server archives this
   * household (caller's own membership -> removed) atomically with the
   * redeem.
   */
  archiveHouseholdId?: string;
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
    mutationFn: ({
      code,
      targetHouseholdId,
      weekStartsOn,
      archiveHouseholdId,
    }) =>
      householdApi.redeemInvite(
        code,
        targetHouseholdId,
        weekStartsOn,
        archiveHouseholdId
      ),
    onSuccess: membership => {
      setHouseholdId(membership.household_id);
      // Defer invalidation so `CodeEntryScreen` can persist role/step and
      // navigate BEFORE `useIsOnboarded` refetches. An immediate invalidate
      // flips the onboarding layout to `loading`, unmounts the wizard Stack,
      // and remounts CODE with empty local state while the invite is gone.
      queueMicrotask(() => {
        // EXCLUDES `invitePreview`: this `onSuccess` runs BEFORE
        // `mutateAsync()`'s own promise resolves for the caller, so this
        // microtask can run before `CodeEntryScreen`'s
        // `await redeemInvite.mutateAsync(...)` continuation has set its own
        // `hasRedeemed` lock — a plain `invalidateQueries` on the whole
        // `household.*` tree would then refetch the preview against the
        // code THIS mutation just consumed and 404 it, tearing down the
        // join UI the caller means to keep showing
        // (`CodeEntryScreen.redeemStability.test.tsx`). The preview has
        // nothing to gain from this invalidation anyway — the code is spent
        // either way — so excluding it is correct, not just convenient.
        queryClient.invalidateQueries({
          predicate: query =>
            query.queryKey[0] === queryKeys.household.all[0] &&
            query.queryKey[1] !== 'invitePreview',
        });
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
