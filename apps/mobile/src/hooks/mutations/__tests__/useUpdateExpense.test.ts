/**
 * @module hooks/mutations/__tests__/useUpdateExpense.test
 * An edit must invalidate the whole `expenses` + `timesheet` caches.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const EXPENSE_ID = '66666666-6666-4666-8666-666666666666';

const updateMock = mock(() =>
  Promise.resolve({ id: EXPENSE_ID, kind: 'expense', status: 'pending' })
);

mock.module('@/src/api/endpoints/expenses', () => ({
  expenseApi: { update: updateMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
}));

let useUpdateExpense: typeof import('../useUpdateExpense').useUpdateExpense;

beforeAll(async () => {
  useUpdateExpense = (await import('../useUpdateExpense')).useUpdateExpense;
});

describe('useUpdateExpense', () => {
  it('updates the expense and invalidates the expenses + timesheet caches', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useUpdateExpense()
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        expenseId: EXPENSE_ID,
        input: {
          kind: 'expense',
          local_date: '2026-08-03',
          description: 'Updated',
          amount_minor: 1500,
          currency: 'GBP',
        },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(updateMock).toHaveBeenCalledWith(EXPENSE_ID, {
      kind: 'expense',
      local_date: '2026-08-03',
      description: 'Updated',
      amount_minor: 1500,
      currency: 'GBP',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.expenses.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timesheet.all,
    });
  });
});
