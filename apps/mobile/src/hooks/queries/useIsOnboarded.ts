import { SETUP_ROLES, type SetupRole } from '@/src/domains/setup/types';
import { useAuthStore } from '@/src/store/auth';
import { useChildren } from './useChildren';
import { useHouseholds } from './useHouseholds';

export type OnboardingStatus = 'loading' | 'onboarded' | 'not-onboarded';

export interface OnboardingState {
  status: OnboardingStatus;
  /** Derived from server membership. Null while loading or genuinely unset. */
  role: SetupRole | null;
  /** The relevant household id, if any — the one this user owns (parent) or
   * belongs to (nanny). Null while loading or if none exists yet. */
  householdId: string | null;
}

/**
 * SINGLE CHOKE POINT for "is this user set up" and "which role are they" —
 * every other place in the app (entry router, Today's child-chip gating,
 * mid-wizard screens) should read from here rather than re-deriving its own
 * answer.
 *
 * SERVER-DERIVED, not local MMKV. `setupProgress` (Zustand) tracks in-flight
 * wizard UI state ONLY (which step is currently showing) — it is NOT
 * consulted here on purpose. Local state doesn't survive sign-out/sign-in, a
 * reinstall, or a second device, and disagreeing with the server is exactly
 * what caused a returning, already-set-up parent to be stranded permanently
 * on the invite screen: `setupProgress` got wiped on re-sign-in, this hook
 * used to read `setupProgress.isComplete`, and the (also nulled) cached
 * household id meant downstream screens' effects never fired. See the
 * `SIGNED_IN` handler fix in `store/auth.ts` for the other half of that bug.
 *
 * - Parent: onboarded once they own (created) a household with >= 1 child.
 * - Nanny: onboarded once she's an active member of >= 1 household she did
 *   NOT create — Wave 1 never lets anyone create more than one household or
 *   join one they created themselves, so `household.created_by === userId`
 *   is an exact, single-request stand-in for "is the owner/parent member"
 *   without a second round-trip to `/members`. Revisit if co-parents or
 *   multi-household ownership land.
 *
 * TRI-STATE ON PURPOSE: callers MUST treat 'loading' as "don't route yet".
 * Collapsing it into `false` sends an already-onboarded user through the
 * role fork for one frame — the exact class of bug this replaces.
 */
export function useIsOnboarded(): OnboardingState {
  const session = useAuthStore(s => s.session);
  const userId = session?.user?.id;

  const households = useHouseholds();
  const ownedHousehold = households.data?.find(h => h.created_by === userId);
  const memberHousehold = households.data?.find(h => h.created_by !== userId);

  const children = useChildren(ownedHousehold?.id);

  if (households.isLoading) {
    return { status: 'loading', role: null, householdId: null };
  }

  if (ownedHousehold) {
    if (children.isLoading) {
      return {
        status: 'loading',
        role: SETUP_ROLES.PARENT,
        householdId: ownedHousehold.id,
      };
    }
    const hasChild = (children.data?.length ?? 0) > 0;
    return {
      status: hasChild ? 'onboarded' : 'not-onboarded',
      role: SETUP_ROLES.PARENT,
      householdId: ownedHousehold.id,
    };
  }

  if (memberHousehold) {
    return {
      status: 'onboarded',
      role: SETUP_ROLES.NANNY,
      householdId: memberHousehold.id,
    };
  }

  return { status: 'not-onboarded', role: null, householdId: null };
}
