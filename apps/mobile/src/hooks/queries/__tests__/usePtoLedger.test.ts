/**
 * @module hooks/queries/__tests__/usePtoLedger.test
 * Covers: disabled with no householdId/carerId/year, fetches once all three
 * are present, and returns the validated rows (signed minutes intact).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CARER_ID = '33333333-3333-4333-8333-333333333333';
const YEAR = 2026;

const ENTRY = {
  id: '77777777-7777-4777-8777-777777777777',
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  kind: 'usage',
  minutes: -480,
  effective_date: '2026-08-01',
  time_off_id: '66666666-6666-4666-8666-666666666666',
  carer_display_name: 'Amara',
  note: null,
  created_by: null,
  created_at: '2026-08-01T00:00:00.000Z',
};

const getLedgerMock = mock(() => Promise.resolve([ENTRY] as unknown[]));

mock.module('@/src/api/endpoints/pto', () => ({
  ptoApi: { getLedger: getLedgerMock },
}));

let usePtoLedger: typeof import('../usePtoLedger').usePtoLedger;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  usePtoLedger = (await import('../usePtoLedger')).usePtoLedger;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;

  getLedgerMock.mockReset();
  getLedgerMock.mockImplementation(() => Promise.resolve([ENTRY]));
  useAuthStore.setState({
    session: { user: { id: 'parent-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('usePtoLedger', () => {
  it('does not fetch when householdId is missing', () => {
    const { result } = renderHookWithProviders(() =>
      usePtoLedger(undefined, CARER_ID, YEAR)
    );

    expect(result.current.isPending).toBe(true);
    expect(getLedgerMock).not.toHaveBeenCalled();
  });

  it('does not fetch when carerId is missing', () => {
    const { result } = renderHookWithProviders(() =>
      usePtoLedger(HOUSEHOLD_ID, undefined, YEAR)
    );

    expect(result.current.isPending).toBe(true);
    expect(getLedgerMock).not.toHaveBeenCalled();
  });

  it('does not fetch when year is missing', () => {
    const { result } = renderHookWithProviders(() =>
      usePtoLedger(HOUSEHOLD_ID, CARER_ID, undefined)
    );

    expect(result.current.isPending).toBe(true);
    expect(getLedgerMock).not.toHaveBeenCalled();
  });

  it('fetches once household, carer, and year are all present', async () => {
    const { result } = renderHookWithProviders(() =>
      usePtoLedger(HOUSEHOLD_ID, CARER_ID, YEAR)
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(getLedgerMock).toHaveBeenCalledWith(HOUSEHOLD_ID, CARER_ID, YEAR);
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.minutes).toBe(-480);
  });

  it('is disabled while the auth store is not yet initialized', () => {
    useAuthStore.setState({
      session: { user: { id: 'parent-1' } } as unknown as never,
      isInitialized: false,
    } as never);

    const { result } = renderHookWithProviders(() =>
      usePtoLedger(HOUSEHOLD_ID, CARER_ID, YEAR)
    );

    expect(result.current.isPending).toBe(true);
    expect(getLedgerMock).not.toHaveBeenCalled();
  });
});
