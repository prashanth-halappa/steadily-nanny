/** @module hooks/queries/usePtoLedger — a carer's full PTO ledger for one household in one calendar year. */
import { useQuery } from '@tanstack/react-query';
import { ptoApi } from '@/src/api/endpoints/pto';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * Every ledger row (accrual/usage/adjustment) for one (household, carer)
 * pair in one calendar `year`, append-only, newest-first as the API
 * returns them. `null`/undefined `year` disables the query.
 */
export function usePtoLedger(
  householdId: string | null | undefined,
  carerId: string | null | undefined,
  year: number | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.pto.ledger(
      householdId ?? undefined,
      carerId ?? undefined,
      year ?? undefined
    ),
    queryFn: () =>
      ptoApi.getLedger(
        householdId as string,
        carerId as string,
        year as number
      ),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled:
      !!session &&
      isInitialized &&
      isValidId(householdId) &&
      isValidId(carerId) &&
      typeof year === 'number',
  });
}
