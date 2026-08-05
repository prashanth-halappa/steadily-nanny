/**
 * @module hooks/mutations/__tests__/useWithdrawExpense.test
 * A withdraw must invalidate the whole `expenses` + `timesheet` caches.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const EXPENSE_ID = '66666666-6666-4666-8666-666666666666';

const withdrawMock = mock(() => Promise.resolve(undefined));

mock.module('@/src/api/endpoints/expenses', () => ({
  expenseApi: { withdraw: withdrawMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
}));

let useWithdrawExpense: typeof import('../useWithdrawExpense').useWithdrawExpense;

beforeAll(async () => {
  useWithdrawExpense = (await import('../useWithdrawExpense'))
    .useWithdrawExpense;
});

describe('useWithdrawExpense', () => {
  it('withdraws the expense and invalidates the expenses + timesheet caches', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useWithdrawExpense()
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync(EXPENSE_ID);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(withdrawMock).toHaveBeenCalledWith(EXPENSE_ID);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.expenses.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timesheet.all,
    });
  });
});
