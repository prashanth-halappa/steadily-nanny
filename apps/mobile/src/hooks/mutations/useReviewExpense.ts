/** @module hooks/mutations/useReviewExpense — approve or reject a pending expense/mileage claim. Parent only. */
import type {
  Expense,
  ReviewExpenseRequest,
} from '@steadily-nanny/shared-types/schemas/expense.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { expenseApi } from '@/src/api/endpoints/expenses';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

interface ReviewExpenseInput {
  expenseId: string;
  input: ReviewExpenseRequest;
}

/**
 * Approves or rejects a `pending` row. Server-gated to a parent/owner.
 * Approving mileage freezes `miles × the effective rate` into
 * `amount_minor` server-side; a household with no mileage rate set refuses
 * with a typed error (`ExpenseValidationError`, `metadata.reason ===
 * 'NO_MILEAGE_RATE'`) instead of approving at £0.00 — `onError` here still
 * shows the generic toast; the review sheet inspects the raw error itself
 * for the specific "set a mileage rate" arm (TIER0-CX-SPEC.md §6.2), same
 * split as `ApproveWeekDialog`'s caller-owns-the-specific-copy discipline.
 *
 * An APPROVED review changes the statement (`reimbursements_minor`, and the
 * gross figure it sits beside) — this is the one expense mutation the task
 * brief calls out by name for invalidating "the timesheet week key". The
 * wire route (`/v1/expenses/:expenseId/review`) carries no household id and
 * the reviewed row can belong to any week in the pending queue, so — same
 * reasoning as `useCreateExpense` — this invalidates the WHOLE `timesheet`
 * cache (`queryKeys.timesheet.all`) rather than one week, exactly the
 * broad-invalidate `useApproveTimesheet` already uses for the same reason.
 */
export function useReviewExpense() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<Expense, Error, ReviewExpenseInput>({
    mutationFn: ({ expenseId, input }) => expenseApi.review(expenseId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
