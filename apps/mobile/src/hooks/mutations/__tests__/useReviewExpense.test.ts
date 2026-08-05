/**
 * @module hooks/mutations/__tests__/useReviewExpense.test
 * A review (approve/reject) must invalidate the whole `expenses` +
 * `timesheet` caches — an approved expense changes the statement.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const EXPENSE_ID = '66666666-6666-4666-8666-666666666666';

const reviewMock = mock(() =>
  Promise.resolve({ id: EXPENSE_ID, kind: 'expense', status: 'approved' })
);

mock.module('@/src/api/endpoints/expenses', () => ({
  expenseApi: { review: reviewMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
}));

let useReviewExpense: typeof import('../useReviewExpense').useReviewExpense;

beforeAll(async () => {
  useReviewExpense = (await import('../useReviewExpense')).useReviewExpense;
});

describe('useReviewExpense', () => {
  it('reviews the expense and invalidates the expenses + timesheet caches', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useReviewExpense()
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        expenseId: EXPENSE_ID,
        input: { status: 'approved' },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reviewMock).toHaveBeenCalledWith(EXPENSE_ID, { status: 'approved' });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.expenses.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.timesheet.all,
    });
  });

  it('surfaces the raw error to the caller (for the no-mileage-rate arm)', async () => {
    reviewMock.mockImplementationOnce(() =>
      Promise.reject(
        Object.assign(new Error('validation'), {
          response: {
            status: 400,
            data: {
              error: {
                code: 'VALIDATION_ERROR',
                metadata: { reason: 'NO_MILEAGE_RATE' },
              },
            },
          },
        })
      )
    );
    const { result } = renderHookWithProviders(() => useReviewExpense());

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          expenseId: EXPENSE_ID,
          input: { status: 'approved' },
        })
      ).rejects.toThrow();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error as unknown as {
      response?: { data?: { error?: { metadata?: { reason?: string } } } };
    };
    expect(error.response?.data?.error?.metadata?.reason).toBe(
      'NO_MILEAGE_RATE'
    );
  });
});
