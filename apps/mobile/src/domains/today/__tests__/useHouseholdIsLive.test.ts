/**
 * @module domains/today/__tests__/useHouseholdIsLive.test
 *
 * Wave 1 (void-time-entry) — pins that voided week entries never warm the
 * Today live wash. The hook only checks `status === 'running'` today; these
 * are the regression net if that predicate ever broadens.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
import type { TimeEntry } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { queryKeys } from '@/src/api/queryKeys';
import { getWeekStartISO } from '@/src/domains/timesheet/utils/week';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_ID = '33333333-3333-4333-8333-333333333333';
const TIME_ZONE = 'UTC';
const PINNED_NOW = new Date('2026-08-06T12:00:00.000Z');
const WEEK_START = getWeekStartISO(PINNED_NOW, TIME_ZONE, 1);

setSystemTime(PINNED_NOW);
afterAll(() => setSystemTime());

let useHouseholdIsLive: typeof import('../hooks/useHouseholdIsLive').useHouseholdIsLive;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

function makeEntry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    id: 'entry-1',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    carer_display_name: 'Sarah',
    shift_id: null,
    clock_in_at: `${WEEK_START}T08:00:00.000Z`,
    clock_out_at: `${WEEK_START}T16:00:00.000Z`,
    break_minutes: 0,
    scheduled_minutes: null,
    kind: 'worked',
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: 'submitted',
    local_date: WEEK_START,
    timezone: TIME_ZONE,
    created_at: `${WEEK_START}T08:00:00.000Z`,
    updated_at: `${WEEK_START}T08:00:00.000Z`,
    ...overrides,
  };
}

function seedClient(entries: TimeEntry[], running: TimeEntry | null) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(
    queryKeys.timeEntry.week(HOUSEHOLD_ID, WEEK_START),
    entries
  );
  queryClient.setQueryData(queryKeys.timeEntry.running(), running);
  return queryClient;
}

beforeAll(async () => {
  mock.module('@/src/api/endpoints/timeEntries', () => ({
    timeEntryApi: {
      getRunning: mock(() => Promise.resolve(null)),
      listForWeek: mock(() => Promise.resolve([])),
    },
  }));

  useHouseholdIsLive = (await import('../hooks/useHouseholdIsLive'))
    .useHouseholdIsLive;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;
});

beforeEach(() => {
  useAuthStore.setState({
    session: { user: { id: CARER_ID } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('useHouseholdIsLive — voided entries (069 soft delete)', () => {
  it('returns false when the household week has only voided entries', () => {
    const queryClient = seedClient(
      [
        makeEntry({
          status: 'voided',
          clock_in_at: '2026-08-06T08:00:00.000Z',
          clock_out_at: '2026-08-06T16:00:00.000Z',
          local_date: '2026-08-06',
        }),
      ],
      null
    );

    const { result } = renderHookWithProviders(
      () => useHouseholdIsLive(HOUSEHOLD_ID, TIME_ZONE, 1),
      { queryClient }
    );

    expect(result.current).toBe(false);
  });

  it('returns true when a household week entry is still running', () => {
    const running = makeEntry({
      status: 'running',
      clock_in_at: '2026-08-06T08:00:00.000Z',
      clock_out_at: null,
      local_date: '2026-08-06',
    });
    const queryClient = seedClient([running], running);

    const { result } = renderHookWithProviders(
      () => useHouseholdIsLive(HOUSEHOLD_ID, TIME_ZONE, 1),
      { queryClient }
    );

    expect(result.current).toBe(true);
  });

  it('returns false when voided and submitted entries exist but nothing is running', () => {
    const queryClient = seedClient(
      [
        makeEntry({
          id: 'voided',
          status: 'voided',
          clock_in_at: '2026-08-06T06:00:00.000Z',
          clock_out_at: '2026-08-06T10:00:00.000Z',
          local_date: '2026-08-06',
        }),
        makeEntry({
          id: 'submitted',
          status: 'submitted',
          clock_in_at: '2026-08-06T12:00:00.000Z',
          clock_out_at: '2026-08-06T16:00:00.000Z',
          local_date: '2026-08-06',
        }),
      ],
      null
    );

    const { result } = renderHookWithProviders(
      () => useHouseholdIsLive(HOUSEHOLD_ID, TIME_ZONE, 1),
      { queryClient }
    );

    expect(result.current).toBe(false);
  });
});
