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
  /**
   * The RAW `household_members.role` for the same membership `role` is
   * derived from — `owner` and `parent` kept apart, which `role` deliberately
   * collapses (S4, `docs/design/attention-and-notifications.md` §7).
   *
   * ADDITIVE. `role` is unchanged and every existing consumer of it is
   * correct; this exists so a surface that needs to know WHICH kind of parent
   * is reading (the `approval_mode='owner_only'` restricted state) can ask,
   * instead of showing a co-parent an Approve button that 403s. Consumed via
   * `useRestrictedAction`, never as a second write gate of its own — the
   * server's gate is still the one that decides.
   */
  membershipRole: HouseholdRole | null;
  /** The relevant household id for the resolved membership. Null while
   * loading or if none exists yet. */
  householdId: string | null;
  /**
   * The resolved membership is `removed` — the user was taken out of this
   * household but keeps read-only access to the hours and pay she accrued in
   * it. THE honest write gate: screens must AND this into whatever role check
   * they already do, never offer a write affordance when it is true.
   *
   * Honoured today by: `HoursScreen` (both role views — approve/query/reopen,
   * expense add/edit/withdraw, time entry corrections), `TodayScreen`'s
   * clock-in card, `TimeOffScreen` (request/edit/cancel), the parent
   * `household-time-off` route's mark-paid sheet, `PaySetupScreen`,
   * `PayArrangementScreen`, and `ScheduleShiftsScreen`'s add-extra affordance.
   * `MyPayScreen` needs no gate: it offers no writes.
   *
   * Until the server stopped filtering `removed` rows out of
   * `GET /v1/users/me/memberships` this was permanently false and every one of
   * those gates was dead code — see `householdQueryService.listMembershipsForUser`.
   *
   * ponytail: NOT yet honoured by `ShiftDetailScreen` (accept/decline/change
   * request — no single choke point, it would mean ANDing into three separate
   * booleans), `ScheduleRespondScreen` (doesn't call this hook at all),
   * `SchedulePendingScreen`, `ScheduleBuildScreen`, `ExtraShiftScreen`
   * (reachable only by deep link now that its entry point is gated), and the
   * inbox. Those all have source-inspection tests rather than render tests, so
   * a gate there is cheap to write and expensive to prove; the API refuses the
   * write with a 403 regardless, so the failure mode is an error toast, not a
   * bad write. Widen the gate as those screens gain render tests.
   */
  isPastMember: boolean;
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
  // A removed member is set up — she just has no live household. Reporting
  // her as not-onboarded routes her into the signup wizard, which puts the
  // hours and pay she is still owed permanently out of reach.
  if (membership.status === HOUSEHOLD_MEMBER_STATUSES.REMOVED) {
    return true;
  }
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

  const memberships = membershipsQuery.data ?? [];
  const activeMemberships = memberships.filter(
    membership => membership.status === HOUSEHOLD_MEMBER_STATUSES.ACTIVE
  );

  // The last fall-through covers a nanny whose ONLY membership is `removed`:
  // both prior terms are null for her, and leaving the id null reported her
  // as a brand-new user. It also holds during the frame before the
  // past-households query resolves, so routing never depends on that timing.
  const resolvedHouseholdId =
    activeHousehold.householdId ??
    activeMemberships[0]?.household_id ??
    memberships[0]?.household_id ??
    null;

  // Prefer the row for the household actually selected — INCLUDING a removed
  // one. Falling through to `activeMemberships[0]` for a household the user
  // was removed from would report a DIFFERENT family's role against the
  // household on screen.
  const membership =
    (resolvedHouseholdId
      ? memberships.find(m => m.household_id === resolvedHouseholdId)
      : undefined) ??
    activeMemberships[0] ??
    null;

  const isPastMember = membership?.status === HOUSEHOLD_MEMBER_STATUSES.REMOVED;

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
      membershipRole: null,
      householdId: null,
      isPastMember: false,
      membershipsError: true,
      retryMemberships,
    };
  }

  if (membershipsQuery.isPending || activeHousehold.isLoading) {
    return {
      status: 'loading',
      role: null,
      membershipRole: null,
      householdId: null,
      isPastMember: false,
      membershipsError: false,
      retryMemberships,
    };
  }

  if (!membership || !setupRole) {
    return {
      status: 'not-onboarded',
      role: null,
      membershipRole: null,
      householdId: null,
      isPastMember: false,
      membershipsError: false,
      retryMemberships,
    };
  }

  if (needsChildCount && children.isPending) {
    return {
      status: 'loading',
      role: setupRole,
      membershipRole: membership.role,
      householdId: resolvedHouseholdId,
      isPastMember,
      membershipsError: false,
      retryMemberships,
    };
  }

  const childCount = needsChildCount ? (children.data?.length ?? 0) : 0;
  const onboarded = isOnboardedForMembership(membership, childCount);

  return {
    status: onboarded ? 'onboarded' : 'not-onboarded',
    role: setupRole,
    membershipRole: membership.role,
    householdId: resolvedHouseholdId,
    isPastMember,
    membershipsError: false,
    retryMemberships,
  };
}
