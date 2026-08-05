/** @module hooks/queries/usePtoBalance — a carer's PTO balance for one household in one calendar year. */
import { useQuery } from '@tanstack/react-query';
import { ptoApi } from '@/src/api/endpoints/pto';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * The PTO balance for one (household, carer) pair in one calendar `year`,
 * or `null` when the effective arrangement has no
 * `pto_entitlement_minutes_per_year` set — "not set", never fabricated as
 * zero (docs/11-MONEY.md §4's discipline). `null`/undefined `year` disables
 * the query rather than fetching an undefined year server-side.
 */
export function usePtoBalance(
  householdId: string | null | undefined,
  carerId: string | null | undefined,
  year: number | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.pto.balance(
      householdId ?? undefined,
      carerId ?? undefined,
      year ?? undefined
    ),
    queryFn: () =>
      ptoApi.getBalance(
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
