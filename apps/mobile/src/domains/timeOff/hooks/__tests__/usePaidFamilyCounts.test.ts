/**
 * @module domains/timeOff/hooks/__tests__/usePaidFamilyCounts.test
 *
 * TIER0-CX-SPEC.md §5.2: the `/settings/time-off` surface must answer "how
 * many families paid this" WITHOUT ever knowing (or exposing) a household
 * NAME — `carer_time_off` deliberately carries no household reference
 * (011_availability.sql), so this hook asks each of the carer's OWN
 * households whether their `pto_ledger` references the time-off id, and
 * counts households, never naming one.
 *
 * Phase 3+4 adversarial review, finding 2: a household counts as "paid"
 * only after NETTING its `usage` row against any reversing `adjustment`
 * rows sharing the same `time_off_id` — the ledger is append-only, so a
 * cancelled-and-reversed time off's usage row never disappears.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_A = 'household-a';
const HOUSEHOLD_B = 'household-b';
const CARER_ID = 'carer-1';
const TIME_OFF_PAID_BY_BOTH = 'timeoff-both';
const TIME_OFF_PAID_BY_ONE = 'timeoff-one';
const TIME_OFF_UNPAID = 'timeoff-none';
const TIME_OFF_FULLY_REVERSED = 'timeoff-reversed';
const TIME_OFF_PARTIALLY_REVERSED = 'timeoff-partial';

const householdA = { id: HOUSEHOLD_A, name: 'The Smiths', timezone: 'UTC' };
const householdB = { id: HOUSEHOLD_B, name: 'The Reyes', timezone: 'UTC' };

const listMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([householdA, householdB])
);
const getLedgerMock = mock<(householdId: string) => Promise<unknown[]>>(
  (householdId: string) => {
    if (householdId === HOUSEHOLD_A) {
      return Promise.resolve([
        { kind: 'usage', time_off_id: TIME_OFF_PAID_BY_BOTH, minutes: -480 },
        { kind: 'usage', time_off_id: TIME_OFF_PAID_BY_ONE, minutes: -480 },
      ]);
    }
    if (householdId === HOUSEHOLD_B) {
      return Promise.resolve([
        { kind: 'usage', time_off_id: TIME_OFF_PAID_BY_BOTH, minutes: -480 },
      ]);
    }
    return Promise.resolve([]);
  }
);

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { list: listMock },
}));
mock.module('@/src/api/endpoints/pto', () => ({
  ptoApi: { getLedger: getLedgerMock },
}));

let usePaidFamilyCounts: typeof import('../usePaidFamilyCounts').usePaidFamilyCounts;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

const timeOffRows = [
  { id: TIME_OFF_PAID_BY_BOTH, starts_at: '2026-08-10T00:00:00.000Z' },
  { id: TIME_OFF_PAID_BY_ONE, starts_at: '2026-08-11T00:00:00.000Z' },
  { id: TIME_OFF_UNPAID, starts_at: '2026-08-12T00:00:00.000Z' },
] as never;

beforeEach(async () => {
  usePaidFamilyCounts = (await import('../usePaidFamilyCounts'))
    .usePaidFamilyCounts;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;

  listMock.mockReset();
  getLedgerMock.mockReset();
  listMock.mockImplementation(() => Promise.resolve([householdA, householdB]));
  getLedgerMock.mockImplementation((householdId: string) => {
    if (householdId === HOUSEHOLD_A) {
      return Promise.resolve([
        { kind: 'usage', time_off_id: TIME_OFF_PAID_BY_BOTH, minutes: -480 },
        { kind: 'usage', time_off_id: TIME_OFF_PAID_BY_ONE, minutes: -480 },
      ]);
    }
    if (householdId === HOUSEHOLD_B) {
      return Promise.resolve([
        { kind: 'usage', time_off_id: TIME_OFF_PAID_BY_BOTH, minutes: -480 },
      ]);
    }
    return Promise.resolve([]);
  });

  useAuthStore.setState({
    session: { user: { id: CARER_ID } } as unknown as never,
    user: { id: CARER_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('usePaidFamilyCounts', () => {
  it('counts DISTINCT households that paid each time-off id', async () => {
    const { result } = renderHookWithProviders(() =>
      usePaidFamilyCounts(timeOffRows)
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.counts.get(TIME_OFF_PAID_BY_BOTH)).toBe(2);
    expect(result.current.counts.get(TIME_OFF_PAID_BY_ONE)).toBe(1);
    expect(result.current.counts.get(TIME_OFF_UNPAID)).toBeUndefined();
  });

  it('reports isLoading true until every household ledger has resolved', () => {
    const { result } = renderHookWithProviders(() =>
      usePaidFamilyCounts(timeOffRows)
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('never calls the ledger endpoint with anything but household ids', async () => {
    renderHookWithProviders(() => usePaidFamilyCounts(timeOffRows));

    await waitFor(() => expect(getLedgerMock).toHaveBeenCalled());
    for (const call of getLedgerMock.mock.calls) {
      expect([HOUSEHOLD_A, HOUSEHOLD_B]).toContain(call[0]);
    }
  });

  it('FULLY reversed: a household no longer counts once its usage row is fully reversed', async () => {
    getLedgerMock.mockImplementation((householdId: string) => {
      if (householdId === HOUSEHOLD_A) {
        return Promise.resolve([
          {
            kind: 'usage',
            time_off_id: TIME_OFF_FULLY_REVERSED,
            minutes: -480,
          },
          {
            kind: 'adjustment',
            time_off_id: TIME_OFF_FULLY_REVERSED,
            minutes: 480,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const rows = [
      {
        id: TIME_OFF_FULLY_REVERSED,
        starts_at: '2026-08-10T00:00:00.000Z',
      },
    ] as never;

    const { result } = renderHookWithProviders(() => usePaidFamilyCounts(rows));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.counts.get(TIME_OFF_FULLY_REVERSED)).toBeUndefined();
  });

  it('PARTIALLY reversed: the household still counts', async () => {
    getLedgerMock.mockImplementation((householdId: string) => {
      if (householdId === HOUSEHOLD_A) {
        return Promise.resolve([
          {
            kind: 'usage',
            time_off_id: TIME_OFF_PARTIALLY_REVERSED,
            minutes: -480,
          },
          {
            kind: 'adjustment',
            time_off_id: TIME_OFF_PARTIALLY_REVERSED,
            minutes: 240,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const rows = [
      {
        id: TIME_OFF_PARTIALLY_REVERSED,
        starts_at: '2026-08-10T00:00:00.000Z',
      },
    ] as never;

    const { result } = renderHookWithProviders(() => usePaidFamilyCounts(rows));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.counts.get(TIME_OFF_PARTIALLY_REVERSED)).toBe(1);
  });
});
