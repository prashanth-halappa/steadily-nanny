/** @module hooks/queries/useHouseholdHolidays — a household's holiday toggles. Member-visible. */
import { useQuery } from '@tanstack/react-query';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useHouseholdHolidays(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.household.holidays(householdId ?? undefined),
    queryFn: () => householdApi.listHolidays(householdId as string),
    staleTime: QUERY_TIMING.STALE_1H,
    enabled: !!session && isInitialized && isValidId(householdId),
  });
}
