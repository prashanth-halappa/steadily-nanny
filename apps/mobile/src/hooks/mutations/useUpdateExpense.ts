/** @module hooks/mutations/useUpdateExpense — edit a still-pending expense/mileage claim the caller owns. */
import type {
  Expense,
  UpdateExpenseRequest,
} from '@steadily-nanny/shared-types/schemas/expense.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { expenseApi } from '@/src/api/endpoints/expenses';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

interface UpdateExpenseInput {
  expenseId: string;
  input: UpdateExpenseRequest;
}

/**
 * Edits a `pending` expense/mileage row the caller owns (docs/11-MONEY.md
 * §8 "pending-expense corrections"). Once reviewed, the row is immutable —
 * the server 409s (`EXPENSE_NOT_EDITABLE`, reason `already_reviewed`). The
 * wire route (`/v1/expenses/:expenseId`) is not household-scoped, so this
 * hook takes no `householdId` param — unlike `useCreateExpense`.
 *
 * Same broad `expenses`/`timesheet` invalidation as `useCreateExpense` —
 * see that hook's doc comment for why: an edit can move `local_date` into a
 * different household-local week than the one on screen.
 */
export function useUpdateExpense() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<Expense, Error, UpdateExpenseInput>({
    mutationFn: ({ expenseId, input }) => expenseApi.update(expenseId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
