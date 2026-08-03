import {
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_ROLES,
  type HouseholdMember,
  type HouseholdRole,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { useCallback } from 'react';
import { SETUP_ROLES, type SetupRole } from '@/src/domains/setup/types';
import { useActiveHousehold } from './useActiveHousehold';
import { useChildren } from './useChildren';
import { useMyMemberships } from './useMyMemberships';

export type OnboardingStatus = 'loading' | 'onboarded' | 'not-onboarded';

export interface OnboardingState {
  status: OnboardingStatus;
  /** Derived from server membership. Null while loading or genuinely unset. */
  role: SetupRole | null;
  /** The relevant household id for the resolved membership. Null while
   * loading or if none exists yet. */
  householdId: string | null;
  /**
   * The memberships query FAILED — we do not know whether this user is
   * onboarded. Deliberately DISTINCT from "resolved with zero memberships":
   * callers must never treat this as not-onboarded (see the header comment).
   */
  membershipsError: boolean;
  /** Retry the underlying memberships query. */
  retryMemberships: () => void;
}

function membershipRoleToSetupRole(role: HouseholdRole): SetupRole | null {
  if (role === HOUSEHOLD_ROLES.OWNER || role === HOUSEHOLD_ROLES.PARENT) {
    return SETUP_ROLES.PARENT;
  }
  if (role === HOUSEHOLD_ROLES.NANNY) {
    return SETUP_ROLES.NANNY;
  }
  if (role === HOUSEHOLD_ROLES.HELPER) {
    return SETUP_ROLES.HELPER;
  }
  return null;
}

function isOnboardedForMembership(
  membership: HouseholdMember,
  childCount: number
): boolean {
  if (membership.status !== HOUSEHOLD_MEMBER_STATUSES.ACTIVE) {
    return false;
  }
  if (membership.role === HOUSEHOLD_ROLES.OWNER) {
    return childCount > 0;
  }
  if (
    membership.role === HOUSEHOLD_ROLES.PARENT ||
    membership.role === HOUSEHOLD_ROLES.NANNY ||
    membership.role === HOUSEHOLD_ROLES.HELPER
  ) {
    return true;
  }
  return false;
}

/**
 * SINGLE CHOKE POINT for "is this user set up" and "which role are they" —
 * every other place in the app (entry router, Today's child-chip gating,
 * mid-wizard screens) should read from here rather than re-deriving its own
 * answer.
 *
 * SERVER-DERIVED, not local MMKV. `setupProgress` (Zustand) tracks in-flight
 * wizard UI state ONLY (which step is currently showing) — it is NOT
 * consulted here on purpose.
 *
 * Role and onboarded status come from `GET /v1/users/me/memberships`, keyed
 * to the active household when the switcher has one (`useActiveHousehold`),
 * otherwise the first active membership:
 *
 * - Owner (SETUP_ROLES.PARENT): onboarded once the household has >= 1 child.
 * - Co-parent (SETUP_ROLES.PARENT, membership role `parent`): onboarded on
 *   membership alone — they join an existing family that already has kids.
 * - Nanny: onboarded on an active nanny membership.
 * - Helper (SETUP_ROLES.HELPER): onboarded on an active helper membership.
 *
 * TRI-STATE ON PURPOSE: callers MUST treat 'loading' as "don't route yet".
 *
 * A FAILED memberships query is reported as `status: 'loading'` plus
 * `membershipsError: true` — NOT as 'not-onboarded'. This matters:
 * `membershipsQuery.data` is undefined on error, and the `?? []` below turns
 * that into "no memberships", which is byte-identical to a genuinely new user.
 * That shipped, and on device it routed a nanny holding two active
 * memberships into the "Who are you?" role fork with the API unreachable.
 *
 * Reporting the unknown case as 'loading' is the deliberate failure mode: a
 * caller that forgets to check `membershipsError` shows a spinner, which is
 * recoverable, instead of dropping a real user into the signup wizard, which
 * is not. Unknown must fail toward WAIT, never toward ASSUME NEW USER.
 *
 * Wait on `isPending`, not `isLoading`. TanStack Query v5 defines
 * `isLoading = isPending && isFetching`. When a query is still unresolved but
 * not fetching yet (pending+idle — disabled→enabled flip, frame after
 * `queryClient.clear()` on SIGNED_IN), `isLoading` is false while `data` is
 * still undefined. That used to fall through to `!membership` →
 * `not-onboarded`, Index replaced into `/onboarding/role`, and the user saw
 * a "Who are you?" flash before memberships resolved. `isPending` covers
 * that gap; a successful empty list (`isPending === false`, `data === []`)
 * remains a genuine `not-onboarded`.
 */
export function useIsOnboarded(): OnboardingState {
  const membershipsQuery = useMyMemberships();
  const activeHousehold = useActiveHousehold();

  const retryMemberships = useCallback(() => {
    void membershipsQuery.refetch();
  }, [membershipsQuery.refetch]);
  const membershipsError = membershipsQuery.isError;

  const activeMemberships = (membershipsQuery.data ?? []).filter(
    membership => membership.status === HOUSEHOLD_MEMBER_STATUSES.ACTIVE
  );

  const resolvedHouseholdId =
    activeHousehold.householdId ?? activeMemberships[0]?.household_id ?? null;

  const membership =
    (resolvedHouseholdId
      ? activeMemberships.find(m => m.household_id === resolvedHouseholdId)
      : undefined) ??
    activeMemberships[0] ??
    null;

  const setupRole = membership
    ? membershipRoleToSetupRole(membership.role)
    : null;

  const needsChildCount =
    membership?.role === HOUSEHOLD_ROLES.OWNER && resolvedHouseholdId;

  const children = useChildren(
    needsChildCount ? resolvedHouseholdId : undefined
  );

  // BEFORE the loading check, and long before the not-onboarded check: an
  // errored query must never fall through to `!membership` below, which cannot
  // tell "the request failed" from "this user has no memberships".
  if (membershipsError) {
    return {
      status: 'loading',
      role: null,
      householdId: null,
      membershipsError: true,
      retryMemberships,
    };
  }

  if (membershipsQuery.isPending || activeHousehold.isLoading) {
    return {
      status: 'loading',
      role: null,
      householdId: null,
      membershipsError: false,
      retryMemberships,
    };
  }

  if (!membership || !setupRole) {
    return {
      status: 'not-onboarded',
      role: null,
      householdId: null,
      membershipsError: false,
      retryMemberships,
    };
  }

  if (needsChildCount && children.isPending) {
    return {
      status: 'loading',
      role: setupRole,
      householdId: resolvedHouseholdId,
      membershipsError: false,
      retryMemberships,
    };
  }

  const childCount = needsChildCount ? (children.data?.length ?? 0) : 0;
  const onboarded = isOnboardedForMembership(membership, childCount);

  return {
    status: onboarded ? 'onboarded' : 'not-onboarded',
    role: setupRole,
    householdId: resolvedHouseholdId,
    membershipsError: false,
    retryMemberships,
  };
}
