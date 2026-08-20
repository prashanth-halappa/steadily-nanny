/**
 * @module hooks/queries/useCanWriteHousehold
 *
 * Resolves write permission based on the current user's membership row
 * in the SPECIFIC household passed in, not the active/switcher household.
 *
 * When the employing parent deletes their account, the remaining members'
 * household_members rows are flipped to status 'removed'. The app must then
 * go read-only for that household. Existing hooks like useIsOnboarded().isPastMember
 * and useActiveHousehold().isPastHousehold answer for the ACTIVE household,
 * which is incorrect when deep linking into a closed household while another
 * household is active. This hook specifically targets the requested household
 * regardless of switcher state.
 */
import { HOUSEHOLD_MEMBER_STATUSES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useAuthStore } from '@/src/store/auth';
import { useMyMemberships } from './useMyMemberships';

export function useCanWriteHousehold(householdId: string | null | undefined) {
  const userId = useAuthStore(s => s.user?.id ?? null);
  const { data: memberships, isLoading: isMembershipsLoading } =
    useMyMemberships();

  // Safety rule: when householdId is missing, memberships are still loading,
  // or the read settled with NO data (it errored, or the query is disabled
  // because the session has not resolved), we do not know the answer. We must
  // not return canWrite: true, and we must not announce a closure
  // (isPastMember: true) we have not confirmed. Unknown fails toward WAIT,
  // never toward an assumption — the same rule `useIsOnboarded` follows.
  if (!householdId || isMembershipsLoading || memberships === undefined) {
    return {
      canWrite: false,
      isPastMember: false,
      isLoading: true,
    };
  }

  const myMembership =
    memberships?.find(
      m => m.household_id === householdId && m.user_id === userId
    ) ?? null;

  const isPastMember =
    myMembership !== null &&
    myMembership.status === HOUSEHOLD_MEMBER_STATUSES.REMOVED;
  const canWrite =
    myMembership !== null &&
    myMembership.status !== HOUSEHOLD_MEMBER_STATUSES.REMOVED;

  return {
    canWrite,
    isPastMember,
    isLoading: false,
  };
}
