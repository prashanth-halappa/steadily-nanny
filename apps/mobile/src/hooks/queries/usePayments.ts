/** @module hooks/queries/usePayments — one approved week's settlement ledger. */
import { useQuery } from '@tanstack/react-query';
import { paymentApi } from '@/src/api/endpoints/payments';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * Every payment recorded against ONE timesheet — the rows behind the week's
 * Paid / Partially paid / Unpaid badge, for both roles (a nanny needs to see
 * what has landed as much as the parent who recorded it).
 *
 * Keyed by timesheet, not by household+week: the ledger is meaningless
 * outside the week it settles, and a household week can hold two carers'
 * timesheets — keying any wider would serve one carer's payments under
 * another's badge.
 *
 * Disabled until there IS a timesheet id. A week with nothing clocked out
 * has no timesheet row at all, and asking for `/timesheets/undefined/payments`
 * is a guaranteed 404 dressed up as a loading state.
 */
export function usePayments(timesheetId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.payment.forTimesheet(timesheetId ?? undefined),
    queryFn: () => paymentApi.list(timesheetId as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled: !!session && isInitialized && !!timesheetId,
  });
}
