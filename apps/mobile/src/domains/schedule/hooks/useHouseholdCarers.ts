/**
 * @module domains/schedule/hooks/useHouseholdCarers
 *
 * Narrow, schedule-domain-local fetch of a household's active carer members
 * (role 'nanny' or 'helper'), for the schedule-build screen's carer picker.
 * `carer_id` on a schedule pattern is a USER id (see
 * `schedulePatternCommandService.respond`, which compares it directly
 * against the authenticated caller), so the picker needs `user_id`, not a
 * membership row id.
 *
 * Delegates the fetch to `householdApi.listMembers` / central query keys so
 * other screens (e.g. shift detail actor labels) share one cache.
 */
import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useQuery } from '@tanstack/react-query';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

const CARER_ROLES = ['nanny', 'helper'] as const;

function isCarerRole(role: HouseholdMember['role']): boolean {
  return (CARER_ROLES as readonly string[]).includes(role);
}

export function useHouseholdCarers(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.household.members(householdId ?? undefined),
    queryFn: () => householdApi.listMembers(householdId as string),
    select: (members: HouseholdMember[]) =>
      members.filter(member => isCarerRole(member.role)),
    staleTime: QUERY_TIMING.STALE_5M,
    enabled: !!session && isInitialized && isValidId(householdId),
  });
}
