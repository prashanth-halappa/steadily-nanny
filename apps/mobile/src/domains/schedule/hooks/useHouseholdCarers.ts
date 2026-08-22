/**
 * @module domains/schedule/hooks/useHouseholdCarers
 *
 * Narrow, schedule-domain-local fetch of a household's active carer members
 * (role 'nanny' ONLY), for the carer pickers on schedule-build and the
 * one-off extra shift. `carer_id` on a schedule pattern is a USER id (see
 * `schedulePatternCommandService.respond`, which compares it directly
 * against the authenticated caller), so the picker needs `user_id`, not a
 * membership row id.
 *
 * DO NOT re-add 'helper'. Every server-side carer gate is nanny-only —
 * `shiftChangeRequestCommandService.assertCarerRole`, `shiftCommandService`,
 * `schedulePatternCommandService`, `timesheetCommandService` — and helpers
 * have no pay arrangement and cannot clock in. Offering a helper chip here
 * only buys the parent a 400 `INVALID_SHIFT_CARER` on submit. This list also
 * feeds the `carers.length === 1` check behind the cover CTA's "Ask <name>"
 * copy and its `carerId` prefill, so a stray helper silently demotes that
 * button to the generic wording.
 *
 * Delegates the fetch to `householdApi.listMembers` / central query keys so
 * other screens (e.g. shift detail actor labels) share one cache.
 */
import {
  HOUSEHOLD_MEMBER_STATUSES,
  type HouseholdMember,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { useQuery } from '@tanstack/react-query';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { useCanWriteHousehold } from '@/src/hooks/queries/useCanWriteHousehold';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

const CARER_ROLES = ['nanny'] as const;

function isCarerRole(role: HouseholdMember['role']): boolean {
  return (CARER_ROLES as readonly string[]).includes(role);
}

export function useHouseholdCarers(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);
  const { canWrite } = useCanWriteHousehold(householdId);

  return useQuery({
    queryKey: queryKeys.household.members(householdId ?? undefined),
    queryFn: () => householdApi.listMembers(householdId as string),
    // The members endpoint intentionally includes candidate rows for the
    // parent's terms-proposal inbox. A candidate must never appear in carer
    // pickers — every server write gate requires an active membership.
    select: (members: HouseholdMember[]) =>
      members.filter(
        member =>
          isCarerRole(member.role) &&
          member.status === HOUSEHOLD_MEMBER_STATUSES.ACTIVE
      ),
    staleTime: QUERY_TIMING.STALE_5M,
    // SAME GATE AS `useHouseholdMembers`, and it has to be: both hooks read
    // the same endpoint under the same query key, so gating one alone leaves
    // the other refetching the key the first just disabled. The roster 404s
    // for a member who has been removed — the server keeps payroll readable
    // for her but not the household's data — and re-asking turns that refusal
    // into a loop that trips the rate limiter.
    enabled: !!session && isInitialized && isValidId(householdId) && canWrite,
  });
}
