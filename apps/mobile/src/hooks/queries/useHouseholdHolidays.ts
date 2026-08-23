/** @module hooks/queries/useHouseholdHolidays — a household's holiday toggles. Member-visible. */
import { useQuery } from '@tanstack/react-query';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { useCanWriteHousehold } from '@/src/hooks/queries/useCanWriteHousehold';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useHouseholdHolidays(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  const { canWrite } = useCanWriteHousehold(householdId);

  return useQuery({
    queryKey: queryKeys.household.holidays(householdId ?? undefined),
    queryFn: () => householdApi.listHolidays(householdId as string),
    staleTime: QUERY_TIMING.STALE_1H,
    // Household-scoped — refused for a past member, so do not ask. Without
    // this the holidays screen rendered a generic network error for what is
    // really a permission the server is right to withhold.
    enabled: !!session && isInitialized && isValidId(householdId) && canWrite,
  });
}
