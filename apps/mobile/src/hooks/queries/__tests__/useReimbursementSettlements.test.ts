/**
 * @module hooks/queries/__tests__/useReimbursementSettlements.test
 * Covers: disabled with no householdId/weekStart, fetches once both are
 * present, disabled before the auth store is initialized.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const WEEK_START = '2026-08-17';

const SETTLEMENT = {
  id: '77777777-7777-4777-8777-777777777777',
  household_id: HOUSEHOLD_ID,
  carer_id: '33333333-3333-4333-8333-333333333333',
  week_start: WEEK_START,
  amount_minor: 3480,
  currency: 'GBP',
  settled_at: '2026-08-18',
  note: null,
  recorded_by: null,
  created_at: '2026-08-18T00:00:00.000Z',
};

const listForWeekMock = mock(() => Promise.resolve([SETTLEMENT as unknown]));

mock.module('@/src/api/endpoints/reimbursementSettlements', () => ({
  reimbursementSettlementApi: { listForWeek: listForWeekMock },
}));

let useReimbursementSettlements: typeof import('../useReimbursementSettlements').useReimbursementSettlements;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  useReimbursementSettlements = (await import('../useReimbursementSettlements'))
    .useReimbursementSettlements;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;

  listForWeekMock.mockReset();
  listForWeekMock.mockImplementation(() => Promise.resolve([SETTLEMENT]));
  useAuthStore.setState({
    session: { user: { id: 'parent-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('useReimbursementSettlements', () => {
  it('does not fetch when householdId is missing', () => {
    const { result } = renderHookWithProviders(() =>
      useReimbursementSettlements(undefined, WEEK_START)
    );

    expect(result.current.isPending).toBe(true);
    expect(listForWeekMock).not.toHaveBeenCalled();
  });

  it('does not fetch when weekStart is missing', () => {
    const { result } = renderHookWithProviders(() =>
      useReimbursementSettlements(HOUSEHOLD_ID, undefined)
    );

    expect(result.current.isPending).toBe(true);
    expect(listForWeekMock).not.toHaveBeenCalled();
  });

  it('fetches once both are present', async () => {
    const { result } = renderHookWithProviders(() =>
      useReimbursementSettlements(HOUSEHOLD_ID, WEEK_START)
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(listForWeekMock).toHaveBeenCalledWith(HOUSEHOLD_ID, WEEK_START);
    expect(result.current.data).toHaveLength(1);
  });

  it('is disabled while the auth store is not yet initialized', () => {
    useAuthStore.setState({
      session: { user: { id: 'parent-1' } } as unknown as never,
      isInitialized: false,
    } as never);

    const { result } = renderHookWithProviders(() =>
      useReimbursementSettlements(HOUSEHOLD_ID, WEEK_START)
    );

    expect(result.current.isPending).toBe(true);
    expect(listForWeekMock).not.toHaveBeenCalled();
  });
});
