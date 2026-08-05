/**
 * @module hooks/mutations/__tests__/useCreateExpense.test
 * Create must invalidate the whole `expenses` cache (covers both `.week`
 * and `.pending` — invalidateQueries matches by key prefix) and the whole
 * `timesheet` cache for this household.
 */
import { beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

const createMock = mock(() =>
  Promise.resolve({
    id: '66666666-6666-4666-8666-666666666666',
    household_id: HOUSEHOLD_ID,
    kind: 'expense',
    status: 'pending',
  })
);

mock.module('@/src/api/endpoints/expenses', () => ({
  expenseApi: { create: createMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
}));

let useCreateExpense: typeof import('../useCreateExpense').useCreateExpense;

beforeAll(async () => {
  useCreateExpense = (await import('../useCreateExpense')).useCreateExpense;
});

describe('useCreateExpense', () => {
  it('creates the expense and invalidates the expenses + timesheet caches', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useCreateExpense(HOUSEHOLD_ID)
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        kind: 'expense',
        local_date: '2026-08-03',
        description: 'Soft play tickets',
        amount_minor: 1200,
        currency: 'GBP',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createMock).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      kind: 'expense',
      local_date: '2026-08-03',
      description: 'Soft play tickets',
      amount_minor: 1200,
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
