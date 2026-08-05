/**
 * @module hooks/queries/__tests__/useCurrentPayArrangement.test
 * Covers: disabled with no householdId/carerId (never fires
 * `getCurrent(undefined, undefined)`), fetches once both ids are present,
 * and the null "no arrangement yet" result passes through untouched
 * (docs/11-MONEY.md §4 — never coerced, never a thrown error).
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

const getCurrentMock = mock(() => Promise.resolve(ARRANGEMENT as unknown));

mock.module('@/src/api/endpoints/payArrangements', () => ({
  payArrangementApi: { getCurrent: getCurrentMock },
}));

let useCurrentPayArrangement: typeof import('../useCurrentPayArrangement').useCurrentPayArrangement;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  useCurrentPayArrangement = (await import('../useCurrentPayArrangement'))
    .useCurrentPayArrangement;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;

  getCurrentMock.mockReset();
  getCurrentMock.mockImplementation(() => Promise.resolve(ARRANGEMENT));
  useAuthStore.setState({
    session: { user: { id: 'parent-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('useCurrentPayArrangement', () => {
  it('does not fetch when householdId is missing', () => {
    const { result } = renderHookWithProviders(() =>
      useCurrentPayArrangement(undefined, CARER_ID)
    );

    expect(result.current.isPending).toBe(true);
    expect(getCurrentMock).not.toHaveBeenCalled();
  });

  it('does not fetch when carerId is missing', () => {
    const { result } = renderHookWithProviders(() =>
      useCurrentPayArrangement(HOUSEHOLD_ID, undefined)
    );

    expect(result.current.isPending).toBe(true);
    expect(getCurrentMock).not.toHaveBeenCalled();
  });

  it('fetches once both ids are present', async () => {
    const { result } = renderHookWithProviders(() =>
      useCurrentPayArrangement(HOUSEHOLD_ID, CARER_ID)
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(getCurrentMock).toHaveBeenCalledWith(HOUSEHOLD_ID, CARER_ID);
    expect(result.current.data?.rate_minor).toBe(1500);
  });

  it('passes through a null result (no arrangement set) rather than an error', async () => {
    getCurrentMock.mockImplementation(() => Promise.resolve(null));

    const { result } = renderHookWithProviders(() =>
      useCurrentPayArrangement(HOUSEHOLD_ID, CARER_ID)
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('is disabled while the auth store is not yet initialized', () => {
    useAuthStore.setState({
      session: { user: { id: 'parent-1' } } as unknown as never,
      isInitialized: false,
    } as never);

    const { result } = renderHookWithProviders(() =>
      useCurrentPayArrangement(HOUSEHOLD_ID, CARER_ID)
    );

    expect(result.current.isPending).toBe(true);
    expect(getCurrentMock).not.toHaveBeenCalled();
  });
});
