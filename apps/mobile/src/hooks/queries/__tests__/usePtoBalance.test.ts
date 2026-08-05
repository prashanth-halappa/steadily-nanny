/**
 * @module hooks/queries/__tests__/usePtoBalance.test
 * Covers: disabled with no householdId/carerId/year (never fires
 * `getBalance(undefined, undefined, undefined)`), fetches once all three
 * are present, and a negative `balance_minutes` passes through untouched
 * (over-balance is legal — docs/11-MONEY.md §5).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CARER_ID = '33333333-3333-4333-8333-333333333333';
const YEAR = 2026;

const BALANCE = {
  carer_id: CARER_ID,
  household_id: HOUSEHOLD_ID,
  year: YEAR,
  entitlement_minutes: 8400,
  accrued_minutes: 8400,
  used_minutes: 2880,
  balance_minutes: 5520,
};

const getBalanceMock = mock(() => Promise.resolve(BALANCE as unknown));

mock.module('@/src/api/endpoints/pto', () => ({
  ptoApi: { getBalance: getBalanceMock },
}));

let usePtoBalance: typeof import('../usePtoBalance').usePtoBalance;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  usePtoBalance = (await import('../usePtoBalance')).usePtoBalance;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;

  getBalanceMock.mockReset();
  getBalanceMock.mockImplementation(() => Promise.resolve(BALANCE));
  useAuthStore.setState({
    session: { user: { id: 'parent-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('usePtoBalance', () => {
  it('does not fetch when householdId is missing', () => {
    const { result } = renderHookWithProviders(() =>
      usePtoBalance(undefined, CARER_ID, YEAR)
    );

    expect(result.current.isPending).toBe(true);
    expect(getBalanceMock).not.toHaveBeenCalled();
  });

  it('does not fetch when carerId is missing', () => {
    const { result } = renderHookWithProviders(() =>
      usePtoBalance(HOUSEHOLD_ID, undefined, YEAR)
    );

    expect(result.current.isPending).toBe(true);
    expect(getBalanceMock).not.toHaveBeenCalled();
  });

  it('does not fetch when year is missing', () => {
    const { result } = renderHookWithProviders(() =>
      usePtoBalance(HOUSEHOLD_ID, CARER_ID, undefined)
    );

    expect(result.current.isPending).toBe(true);
    expect(getBalanceMock).not.toHaveBeenCalled();
  });

  it('fetches once household, carer, and year are all present', async () => {
    const { result } = renderHookWithProviders(() =>
      usePtoBalance(HOUSEHOLD_ID, CARER_ID, YEAR)
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(getBalanceMock).toHaveBeenCalledWith(HOUSEHOLD_ID, CARER_ID, YEAR);
    expect(result.current.data?.balance_minutes).toBe(5520);
  });

  it('passes a NEGATIVE balance through untouched — over-balance is legal', async () => {
    getBalanceMock.mockImplementation(() =>
      Promise.resolve({ ...BALANCE, balance_minutes: -600 })
    );

    const { result } = renderHookWithProviders(() =>
      usePtoBalance(HOUSEHOLD_ID, CARER_ID, YEAR)
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.balance_minutes).toBe(-600);
  });

  it('passes through a null result (no entitlement to read) rather than an error', async () => {
    getBalanceMock.mockImplementation(() => Promise.resolve(null));

    const { result } = renderHookWithProviders(() =>
      usePtoBalance(HOUSEHOLD_ID, CARER_ID, YEAR)
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('is disabled while the auth store is not yet initialized', () => {
    useAuthStore.setState({
      session: { user: { id: 'parent-1' } } as unknown as never,
      isInitialized: false,
    } as never);

    const { result } = renderHookWithProviders(() =>
      usePtoBalance(HOUSEHOLD_ID, CARER_ID, YEAR)
    );

    expect(result.current.isPending).toBe(true);
    expect(getBalanceMock).not.toHaveBeenCalled();
  });
});
