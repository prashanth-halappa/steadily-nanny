/** @module hooks/mutations/useCreateExpense — add a new expense or mileage claim. Nanny only. */
import type {
  CreateExpenseRequest,
  Expense,
} from '@steadily-nanny/shared-types/schemas/expense.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { expenseApi } from '@/src/api/endpoints/expenses';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Creates a new `pending` expense/mileage claim. Server-gated to an active
 * `nanny` member; `carer_id` is inferred from the caller's session, never
 * sent on the wire (`CreateExpenseRequestSchema` has no such field).
 *
 * On success, invalidates the WHOLE `expenses` cache for this household
 * (both `.week(...)` and `.pending(...)` entries — `invalidateQueries`
 * matches by key PREFIX, so `queryKeys.expenses.all` alone covers every
 * week and the pending list at once) and `queryKeys.timesheet.all` — same
 * broad-invalidate the house already uses in `useApproveTimesheet`, because
 * a nanny can pick a `local_date` outside the week currently on screen and
 * this hook has no reliable way to compute which household-local week that
 * date lands in without duplicating `getWeekStartISO`'s timezone math here.
 * A new claim is `pending` and does not itself change gross/reimbursements,
 * but invalidating keeps the two caches from ever silently disagreeing.
 */
export function useCreateExpense(householdId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<Expense, Error, CreateExpenseRequest>({
    mutationFn: input => expenseApi.create(householdId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
