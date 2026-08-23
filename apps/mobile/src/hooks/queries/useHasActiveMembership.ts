/**
 * @module hooks/queries/useHasActiveMembership
 *
 * "Does this user still work for ANYBODY" — across every household, not the
 * one the switcher happens to have resolved.
 *
 * WHY THIS EXISTS RATHER THAN `useIsOnboarded().isPastMember`. The next reader
 * will assume that flag was the right gate; for a household-scoped surface it
 * is, and for two surfaces it emphatically is not:
 *
 *   - Availability (`carer_availability`) carries NO household id. It is ONE
 *     availability per carer, shared by every family she works for, and its
 *     write (`PUT /v1/availability/me`) is user-scoped — the server accepts it
 *     from anyone signed in.
 *   - Time off is requested by the person, not by the household.
 *
 * `isPastMember` answers only for the RESOLVED household. For a nanny with one
 * family that ended and one that is live, the resolved household is often the
 * ended one, so `isPastMember` is true — and gating on it hid both surfaces
 * from someone who still works four days a week. Conversely, for a nanny whose
 * every membership has ended, it is the write itself that needs stopping, and
 * only "no live membership ANYWHERE" says so honestly.
 *
 * Same safety rule as `useCanWriteHousehold`, which this sits alongside:
 * unknown fails toward WAIT. A null viewer id, a loading query, or a settled
 * read with no data (errored, or disabled because the session has not
 * resolved) all report `isLoading: true` rather than a confident `false` —
 * a false here would tell a working nanny she has been let go.
 *
 * NOT-REMOVED, not strictly ACTIVE — the same line `useCanWriteHousehold`
 * draws. A `candidate` has redeemed a code and is waiting on the family to
 * accept her; the availability she sets is exactly what that family reads
 * while deciding.
 */
import { HOUSEHOLD_MEMBER_STATUSES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useAuthStore } from '@/src/store/auth';
import { useMyMemberships } from './useMyMemberships';

export function useHasActiveMembership(): {
  hasActiveMembership: boolean;
  isLoading: boolean;
} {
  const userId = useAuthStore(s => s.user?.id ?? null);
  const { data: memberships, isLoading: isMembershipsLoading } =
    useMyMemberships();

  if (!userId || isMembershipsLoading || memberships === undefined) {
    return { hasActiveMembership: false, isLoading: true };
  }

  return {
    hasActiveMembership: memberships.some(
      m =>
        m.user_id === userId && m.status !== HOUSEHOLD_MEMBER_STATUSES.REMOVED
    ),
    isLoading: false,
  };
}
