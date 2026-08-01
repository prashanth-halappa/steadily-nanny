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
 * Deliberately NOT added to `src/api/endpoints/household.ts` or
 * `src/api/queryKeys.ts` — both are owned by another agent building the
 * household domain concurrently. This hook calls the already-shipped
 * `GET /v1/households/:householdId/members` route directly and validates the
 * response with the shared `HouseholdMemberListResponseSchema`, so the wire
 * shape still has a single source of truth even though the fetch path is
 * local to this domain. TODO: once `household.ts` grows a
 * `householdApi.listMembers`, replace this with that plus a real
 * `queryKeys.household.members(householdId)` key.
 */
import {
  type HouseholdMember,
  HouseholdMemberListResponseSchema,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/src/api/client';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

const CARER_ROLES = ['nanny', 'helper'] as const;

function isCarerRole(role: HouseholdMember['role']): boolean {
  return (CARER_ROLES as readonly string[]).includes(role);
}

export function useHouseholdCarers(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    // Locally-scoped key (not in the central factory — see module doc).
    queryKey: ['schedulePattern', 'householdCarers', householdId] as const,
    queryFn: async (): Promise<HouseholdMember[]> => {
      const response = await apiClient.get(
        `/v1/households/${householdId}/members`
      );
      const parsed = HouseholdMemberListResponseSchema.safeParse(
        response.data.data
      );
      if (!parsed.success) throw parsed.error;
      return parsed.data.household_members.filter(member =>
        isCarerRole(member.role)
      );
    },
    staleTime: QUERY_TIMING.STALE_5M,
    enabled: !!session && isInitialized && !!householdId,
  });
}
