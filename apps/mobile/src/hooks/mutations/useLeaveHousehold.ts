/**
 * @module hooks/mutations/useLeaveHousehold
 *
 * The member's own way out (`POST .../members/leave`) — the counterpart to
 * `useRemoveMember`, which is somebody ELSE removing you. The owner cannot
 * use it at all (403 `CANNOT_LEAVE_AS_OWNER`); the component decides who is
 * offered the action, the server is what actually refuses.
 *
 * CLEARS THE ACTIVE-HOUSEHOLD PREFERENCE on success, and that is not
 * housekeeping. Leaving soft-removes the membership, so the household moves
 * from `households` to `past_households` — and `useActiveHousehold` resolves
 * a stored preference against BOTH lists (deliberately: a removed nanny must
 * still be able to open the hours she is owed). Left alone, the preference
 * therefore re-selects the household the user just walked out of, now
 * read-only. Resetting it lets the same hook fall back to the first ACTIVE
 * household, and only fall through to a past one when there are none left.
 *
 * Both refusals get their own copy: the generic `errors:forbidden` /
 * `errors:conflict` toasts tell the person nothing they can act on, and
 * "clock out first" is the entire remedy for the 409.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';
import { useActiveHouseholdStore } from '@/src/store/activeHousehold';

interface ErrorLike {
  response?: {
    status?: number;
    data?: { error?: { metadata?: { reason?: string } } };
  };
}

function getLeaveErrorKey(error: unknown): string | undefined {
  const err = (error ?? {}) as ErrorLike;
  const reason = err.response?.data?.error?.metadata?.reason;
  if (err.response?.status === 403 && reason === 'CANNOT_LEAVE_AS_OWNER') {
    return 'household:householdSettings.leaveOwnerError';
  }
  if (
    err.response?.status === 409 &&
    reason === 'CANNOT_LEAVE_WHILE_CLOCKED_IN'
  ) {
    return 'household:householdSettings.leaveClockedInError';
  }
  // 404 is `findActiveMembership` finding nothing: the membership is already
  // removed (two taps, or a parent removed her while the confirm was open) or
  // was never active (a candidate). No reason code to match on — the status
  // alone says it. The generic `errors:notFound` reads like a broken app for
  // what is actually the outcome she asked for.
  if (err.response?.status === 404) {
    return 'household:householdSettings.leaveAlreadyLeftError';
  }
  return undefined;
}

export function useLeaveHousehold() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');
  const resetActiveHousehold = useActiveHouseholdStore(s => s.reset);

  return useMutation<void, Error, string>({
    mutationFn: householdId => householdApi.leave(householdId),
    onSuccess: () => {
      // Order matters only in that the reset must not be conditional on the
      // invalidations resolving — the screen navigates immediately after.
      resetActiveHousehold();
      // `household.all` covers list, past, detail and members in one — every
      // one of them is now wrong for this user.
      queryClient.invalidateQueries({ queryKey: queryKeys.household.all });
      // The membership row is what `useIsOnboarded` derives role and
      // read-only status from; a stale one leaves write affordances up.
      queryClient.invalidateQueries({ queryKey: queryKeys.user.memberships() });
    },
    onError: error => {
      showErrorToast(
        getLocalizedErrorMessage(error, t, getLeaveErrorKey(error))
      );
    },
  });
}
