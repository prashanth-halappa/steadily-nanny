/**
 * @module hooks/queries/__tests__/useWeekExpenses.test
 * Covers: disabled with no householdId/weekStart, fetches once both are
 * present, keyed by `queryKeys.expenses.week`.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const WEEK_START = '2026-08-03';

const EXPENSE = {
  id: '66666666-6666-4666-8666-666666666666',
  household_id: HOUSEHOLD_ID,
  local_date: WEEK_START,
  kind: 'expense',
  description: 'Soft play tickets',
  amount_minor: 1200,
  status: 'pending',
};

const listForWeekMock = mock(() => Promise.resolve([EXPENSE as unknown]));

mock.module('@/src/api/endpoints/expenses', () => ({
  expenseApi: { listForWeek: listForWeekMock },
}));

let useWeekExpenses: typeof import('../useWeekExpenses').useWeekExpenses;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  useWeekExpenses = (await import('../useWeekExpenses')).useWeekExpenses;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;

  listForWeekMock.mockReset();
  listForWeekMock.mockImplementation(() => Promise.resolve([EXPENSE]));
  useAuthStore.setState({
    session: { user: { id: 'nanny-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('useWeekExpenses', () => {
  it('does not fetch when householdId is missing', () => {
    const { result } = renderHookWithProviders(() =>
      useWeekExpenses(undefined, WEEK_START)
    );

    expect(result.current.isPending).toBe(true);
    expect(listForWeekMock).not.toHaveBeenCalled();
  });

  it('does not fetch when weekStart is missing', () => {
    const { result } = renderHookWithProviders(() =>
      useWeekExpenses(HOUSEHOLD_ID, undefined)
    );

    expect(result.current.isPending).toBe(true);
    expect(listForWeekMock).not.toHaveBeenCalled();
  });

  it('fetches once both are present', async () => {
    const { result } = renderHookWithProviders(() =>
      useWeekExpenses(HOUSEHOLD_ID, WEEK_START)
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(listForWeekMock).toHaveBeenCalledWith(HOUSEHOLD_ID, WEEK_START);
    expect(result.current.data).toHaveLength(1);
  });

  it('is disabled while the auth store is not yet initialized', () => {
    useAuthStore.setState({
      session: { user: { id: 'nanny-1' } } as unknown as never,
      isInitialized: false,
    } as never);

    const { result } = renderHookWithProviders(() =>
      useWeekExpenses(HOUSEHOLD_ID, WEEK_START)
    );

    expect(result.current.isPending).toBe(true);
    expect(listForWeekMock).not.toHaveBeenCalled();
  });
});
