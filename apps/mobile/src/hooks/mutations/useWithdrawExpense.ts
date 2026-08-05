/** @module hooks/mutations/useWithdrawExpense — hard-delete a still-pending expense/mileage claim the caller owns. */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { expenseApi } from '@/src/api/endpoints/expenses';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Withdraws a `pending` expense/mileage row the caller owns — a hard
 * delete (docs/11-MONEY.md §8: "nothing downstream references it"). A
 * reviewed row cannot be withdrawn; the server 409s
 * (`EXPENSE_NOT_EDITABLE`, reason `already_reviewed`) and there is nothing
 * to correct here — she adds a fresh claim instead (§8 "Rejected expense").
 *
 * Same broad `expenses`/`timesheet` invalidation as `useCreateExpense` —
 * see that hook's doc comment.
 */
export function useWithdrawExpense() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<void, Error, string>({
    mutationFn: expenseId => expenseApi.withdraw(expenseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
