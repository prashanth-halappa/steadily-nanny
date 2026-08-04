/**
 * @module hooks/queries/__tests__/usePayArrangementHistory.test
 * Covers: disabled with no householdId/carerId (never fires
 * `getHistory(undefined, undefined)`), fetches once both ids are present.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CARER_ID = '33333333-3333-4333-8333-333333333333';

const ARRANGEMENT = {
  id: '44444444-4444-4444-8444-444444444444',
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  rate_minor: 1500,
};

const getHistoryMock = mock(() => Promise.resolve([ARRANGEMENT] as unknown[]));

mock.module('@/src/api/endpoints/payArrangements', () => ({
  payArrangementApi: { getHistory: getHistoryMock },
}));

let usePayArrangementHistory: typeof import('../usePayArrangementHistory').usePayArrangementHistory;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  usePayArrangementHistory = (await import('../usePayArrangementHistory'))
    .usePayArrangementHistory;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;

  getHistoryMock.mockReset();
  getHistoryMock.mockImplementation(() => Promise.resolve([ARRANGEMENT]));
  useAuthStore.setState({
    session: { user: { id: 'parent-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('usePayArrangementHistory', () => {
  it('does not fetch when householdId is missing', () => {
    const { result } = renderHookWithProviders(() =>
      usePayArrangementHistory(undefined, CARER_ID)
    );

    expect(result.current.isPending).toBe(true);
    expect(getHistoryMock).not.toHaveBeenCalled();
  });

  it('does not fetch when carerId is missing', () => {
    const { result } = renderHookWithProviders(() =>
      usePayArrangementHistory(HOUSEHOLD_ID, undefined)
    );

    expect(result.current.isPending).toBe(true);
    expect(getHistoryMock).not.toHaveBeenCalled();
  });

  it('fetches once both ids are present', async () => {
    const { result } = renderHookWithProviders(() =>
      usePayArrangementHistory(HOUSEHOLD_ID, CARER_ID)
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(getHistoryMock).toHaveBeenCalledWith(HOUSEHOLD_ID, CARER_ID);
    expect(result.current.data).toHaveLength(1);
  });

  it('is disabled while the auth store is not yet initialized', () => {
    useAuthStore.setState({
      session: { user: { id: 'parent-1' } } as unknown as never,
      isInitialized: false,
    } as never);

    const { result } = renderHookWithProviders(() =>
      usePayArrangementHistory(HOUSEHOLD_ID, CARER_ID)
    );

    expect(result.current.isPending).toBe(true);
    expect(getHistoryMock).not.toHaveBeenCalled();
  });
});
