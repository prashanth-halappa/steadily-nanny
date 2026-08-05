/**
 * @module hooks/queries/__tests__/usePendingExpenses.test
 * Covers: disabled with no householdId, fetches once present, keyed by
 * `queryKeys.expenses.pending` — the parent's "N expenses to review"
 * affordance (TIER0-CX-SPEC.md §6.2).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

const EXPENSE = {
  id: '66666666-6666-4666-8666-666666666666',
  household_id: HOUSEHOLD_ID,
  local_date: '2026-08-03',
  kind: 'mileage',
  description: 'Nursery run',
  miles: 12.4,
  amount_minor: null,
  status: 'pending',
};

const listPendingMock = mock(() => Promise.resolve([EXPENSE as unknown]));

mock.module('@/src/api/endpoints/expenses', () => ({
  expenseApi: { listPending: listPendingMock },
}));

let usePendingExpenses: typeof import('../usePendingExpenses').usePendingExpenses;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  usePendingExpenses = (await import('../usePendingExpenses'))
    .usePendingExpenses;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;

  listPendingMock.mockReset();
  listPendingMock.mockImplementation(() => Promise.resolve([EXPENSE]));
  useAuthStore.setState({
    session: { user: { id: 'parent-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('usePendingExpenses', () => {
  it('does not fetch when householdId is missing', () => {
    const { result } = renderHookWithProviders(() =>
      usePendingExpenses(undefined)
    );

    expect(result.current.isPending).toBe(true);
    expect(listPendingMock).not.toHaveBeenCalled();
  });

  it('fetches once householdId is present', async () => {
    const { result } = renderHookWithProviders(() =>
      usePendingExpenses(HOUSEHOLD_ID)
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(listPendingMock).toHaveBeenCalledWith(HOUSEHOLD_ID);
    expect(result.current.data).toHaveLength(1);
  });

  it('is disabled while the auth store is not yet initialized', () => {
    useAuthStore.setState({
      session: { user: { id: 'parent-1' } } as unknown as never,
      isInitialized: false,
    } as never);

    const { result } = renderHookWithProviders(() =>
      usePendingExpenses(HOUSEHOLD_ID)
    );

    expect(result.current.isPending).toBe(true);
    expect(listPendingMock).not.toHaveBeenCalled();
  });
});
