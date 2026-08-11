/**
 * @module hooks/mutations/useMarkReimbursed
 *
 * Records that one carer's approved reimbursements for one week went back to
 * her (D-14, attention spec §4.2). Parents only, approved rows only, amount
 * computed server-side — all enforced by the API; this hook's job is the
 * cache.
 *
 * TWO invalidations. The settlements cache is the obvious one — it is what
 * turns the card's state words from "Approved · not reimbursed yet" into
 * "Reimbursed on 18 August". `expenses.all` is the other: the rows this
 * settles are served from that cache, and a settlement is the last thing
 * that happens to them.
 *
 * `payment.all` is deliberately NOT invalidated. A reimbursement settlement
 * is not a payment: it is excluded from gross, from payable minutes and from
 * the payment ceiling because it is the family repaying money she already
 * spent, not wages. Nothing in the payment ledger changed.
 *
 * NO TOAST on failure, unlike `useRecordPayment`. The refusal belongs next
 * to the button that caused it (GOLDEN-FIXES #40) — the caller reads
 * `error` off this mutation and hands it to `ReimbursementsCard`'s
 * `markReimbursedError`.
 */
import type {
  CreateReimbursementSettlementInput,
  ReimbursementSettlement,
} from '@steadily-nanny/shared-types/schemas/reimbursementSettlement.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reimbursementSettlementApi } from '@/src/api/endpoints/reimbursementSettlements';
import { queryKeys } from '@/src/api/queryKeys';

interface MarkReimbursedVariables {
  householdId: string;
  input: CreateReimbursementSettlementInput;
}

export function useMarkReimbursed() {
  const queryClient = useQueryClient();

  return useMutation<ReimbursementSettlement, Error, MarkReimbursedVariables>({
    mutationFn: ({ householdId, input }) =>
      reimbursementSettlementApi.create(householdId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.reimbursementSettlements.all,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all });
    },
  });
}

export type { MarkReimbursedVariables };
