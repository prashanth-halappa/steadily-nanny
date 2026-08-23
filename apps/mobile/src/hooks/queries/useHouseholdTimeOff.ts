/**
 * @module hooks/queries/useHouseholdTimeOff
 * Parent-facing list of carers' time off for one household.
 */
import { useQuery } from '@tanstack/react-query';
import { timeOffApi } from '@/src/api/endpoints/timeOff';
import { queryKeys } from '@/src/api/queryKeys';
import { useCanWriteHousehold } from '@/src/hooks/queries/useCanWriteHousehold';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useHouseholdTimeOff(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  const { canWrite } = useCanWriteHousehold(householdId);

  return useQuery({
    queryKey: queryKeys.timeOff.forHousehold(householdId ?? undefined),
    queryFn: () => timeOffApi.listForHousehold(householdId as string),
    staleTime: QUERY_TIMING.STALE_2M,
    // Household-scoped — refused for a member who has left. Ungated, it 404s
    // and its `isError` feeds `ScheduleShiftsScreen`'s `coverInputsFailed`,
    // which put "We couldn't load this family's care hours" on screen: the app
    // blaming the network for a permission the server is right to withhold,
    // and doing it BEFORE the past-member state could render.
    enabled: !!session && isInitialized && isValidId(householdId) && canWrite,
  });
}
