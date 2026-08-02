import {
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_ROLES,
  type HouseholdMember,
  type HouseholdRole,
} from '@steadily-nanny/shared-types/schemas/household.schema';
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
 */
export function useIsOnboarded(): OnboardingState {
  const membershipsQuery = useMyMemberships();
  const activeHousehold = useActiveHousehold();

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

  if (membershipsQuery.isLoading || activeHousehold.isLoading) {
    return { status: 'loading', role: null, householdId: null };
  }

  if (!membership || !setupRole) {
    return { status: 'not-onboarded', role: null, householdId: null };
  }

  if (needsChildCount && children.isLoading) {
    return {
      status: 'loading',
      role: setupRole,
      householdId: resolvedHouseholdId,
    };
  }

  const childCount = needsChildCount ? (children.data?.length ?? 0) : 0;
  const onboarded = isOnboardedForMembership(membership, childCount);

  return {
    status: onboarded ? 'onboarded' : 'not-onboarded',
    role: setupRole,
    householdId: resolvedHouseholdId,
  };
}
