/** @module hooks/queries/useHouseholdPayments — one household's whole payment history. */
import { useQuery } from '@tanstack/react-query';
import { paymentApi } from '@/src/api/endpoints/payments';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * Every payment recorded in ONE household, across every carer and week —
 * the Payments screen's list, as opposed to `usePayments`' single-week
 * ledger.
 *
 * Disabled until there IS a household id, same reasoning as `usePayments`:
 * asking for `/households/undefined/payments` is a guaranteed 404 dressed up
 * as a loading state.
 */
export function useHouseholdPayments(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.payment.forHousehold(householdId ?? undefined),
    queryFn: () => paymentApi.listForHousehold(householdId as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled: !!session && isInitialized && !!householdId,
  });
}
