/**
 * @module lib/__tests__/useWidgetSnapshotSync.test
 *
 * Wave 1 (void-time-entry) — the parent path passes week entries UNFILTERED
 * into `buildTodaysCoverPayload` and `buildParentWeekPayload`. Voided rows
 * must be handled inside those builders, not by pre-filtering in the sync hook.
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
import { waitFor } from '@testing-library/react-native';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { renderHookWithProviders } from '@/src/test-utils';
import type { WidgetSnapshotSet } from '../widgetSnapshot.types';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_ID = '22222222-2222-4222-8222-222222222222';
const CARER_ID = '33333333-3333-4333-8333-333333333333';
const ZONE = 'Europe/London';
const PINNED_NOW = new Date('2026-08-06T09:00:00.000Z');

setSystemTime(PINNED_NOW);
afterAll(() => setSystemTime());

const applyWidgetSnapshotsMock = mock((_set: WidgetSnapshotSet) => {});
const refreshDayThreadMutateMock = mock(
  (_vars: { householdId: string; localDate: string }, _opts?: unknown) => {}
);

let useWidgetSnapshotSync: typeof import('../useWidgetSnapshotSync').useWidgetSnapshotSync;
let widgetSnapshotActual: typeof import('../widgetSnapshot');
let mockWeekEntries: ReturnType<typeof mock>;
let mockWeekTimesheets: ReturnType<typeof mock>;
let mockTodayShifts: ReturnType<typeof mock>;

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'entry-1',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    carer_display_name: 'Sarah',
    shift_id: null,
    clock_in_at: '2026-08-04T07:00:00.000Z',
    clock_out_at: '2026-08-04T15:15:00.000Z',
    break_minutes: 0,
    scheduled_minutes: 480,
    kind: 'worked',
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: 'submitted',
    local_date: '2026-08-04',
    timezone: ZONE,
    created_at: '2026-08-04T07:00:00.000Z',
    updated_at: '2026-08-04T07:00:00.000Z',
    ...overrides,
  };
}

function lastSnapshot(): WidgetSnapshotSet {
  const lastCall = applyWidgetSnapshotsMock.mock.calls.at(-1);
  if (!lastCall) throw new Error('applyWidgetSnapshots was not called');
  return lastCall[0] as WidgetSnapshotSet;
}

beforeAll(async () => {
  widgetSnapshotActual = await import('../widgetSnapshot');
  mock.module('@/src/lib/widgetSnapshot', () => ({
    ...widgetSnapshotActual,
    applyWidgetSnapshots: applyWidgetSnapshotsMock,
  }));

  mockWeekEntries = mock(() => ({ data: [] as TimeEntry[] }));
  mockWeekTimesheets = mock(() => ({ data: [] as unknown[] }));
  mockTodayShifts = mock(() => ({ data: [] as unknown[] }));

  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({
      status: 'onboarded',
      role: SETUP_ROLES.PARENT,
      householdId: HOUSEHOLD_ID,
      isPastMember: false,
    }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (state: unknown) => unknown) =>
      selector({
        user: { id: PARENT_ID },
        session: { user: { id: PARENT_ID } },
        isInitialized: true,
      }),
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      household: {
        id: HOUSEHOLD_ID,
        name: 'Patel household',
        timezone: ZONE,
      },
      householdId: HOUSEHOLD_ID,
      households: [
        { id: HOUSEHOLD_ID, name: 'Patel household', timezone: ZONE },
      ],
      pastHouseholds: [],
      isPastHousehold: false,
      setActiveHouseholdId: mock(),
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholds', () => ({
    useHouseholds: () => ({
      data: [{ id: HOUSEHOLD_ID, name: 'Patel household', timezone: ZONE }],
    }),
  }));
  mock.module('@/src/hooks/queries/useRunningTimeEntry', () => ({
    useRunningTimeEntry: () => ({ data: null }),
  }));
  mock.module('@/src/hooks/queries/useWeekTimeEntries', () => ({
    useWeekTimeEntries: mockWeekEntries,
  }));
  mock.module('@/src/hooks/queries/useWeekTimesheet', () => ({
    useWeekTimesheet: mockWeekTimesheets,
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [] }),
  }));
  mock.module('@/src/hooks/queries/useMeShifts', () => ({
    useMeShifts: () => ({ data: [], isSuccess: true, isError: false }),
  }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockTodayShifts,
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({
      data: [
        {
          id: 'member-sarah',
          household_id: HOUSEHOLD_ID,
          user_id: CARER_ID,
          role: 'nanny',
          can_edit: false,
          status: 'active',
          display_name_override: 'Sarah',
          colour: null,
          joined_at: '2026-08-01T00:00:00.000Z',
          created_at: '2026-08-01T00:00:00.000Z',
          updated_at: '2026-08-01T00:00:00.000Z',
        },
      ],
    }),
  }));
  mock.module('@/src/hooks/queries/useDayThread', () => ({
    useDayThread: () => ({ data: [] }),
  }));
  mock.module('@/src/hooks/mutations/useRefreshDayThread', () => ({
    useRefreshDayThread: () => ({ mutate: refreshDayThreadMutateMock }),
  }));

  useWidgetSnapshotSync = (await import('../useWidgetSnapshotSync'))
    .useWidgetSnapshotSync;
});

beforeEach(() => {
  applyWidgetSnapshotsMock.mockClear();
  refreshDayThreadMutateMock.mockClear();
  mockWeekEntries.mockReturnValue({ data: [] });
  mockWeekTimesheets.mockReturnValue({ data: [] });
  mockTodayShifts.mockReturnValue({ data: [] });
});

describe('useWidgetSnapshotSync parent path — day-thread refresh (S14)', () => {
  it('fires the best-effort refresh mutation before/alongside the day-thread read', async () => {
    renderHookWithProviders(() => useWidgetSnapshotSync());

    await waitFor(() =>
      expect(refreshDayThreadMutateMock).toHaveBeenCalledWith(
        { householdId: HOUSEHOLD_ID, localDate: '2026-08-06' },
        expect.anything()
      )
    );
  });
});

describe('useWidgetSnapshotSync parent path — voided entries (069)', () => {
  const voidedDay = makeEntry({
    id: 'voided-mon',
    status: 'voided',
    clock_in_at: '2026-08-03T07:00:00.000Z',
    clock_out_at: '2026-08-03T16:00:00.000Z',
    scheduled_minutes: 480,
    local_date: '2026-08-03',
  });
  const activeDay = makeEntry({
    id: 'active-tue',
    status: 'submitted',
    clock_in_at: '2026-08-04T07:00:00.000Z',
    clock_out_at: '2026-08-04T15:15:00.000Z',
    scheduled_minutes: 480,
    local_date: '2026-08-04',
  });

  it('parentWeek hours exclude voided entries passed unfiltered from week query', async () => {
    mockWeekEntries.mockReturnValue({ data: [voidedDay, activeDay] });
    mockWeekTimesheets.mockReturnValue({
      data: [
        {
          status: 'submitted',
          total_minutes: 495,
          updated_at: '2026-08-05T18:00:00.000Z',
          approved_at: null,
        },
      ],
    });

    renderHookWithProviders(() => useWidgetSnapshotSync());

    await waitFor(() =>
      expect(applyWidgetSnapshotsMock).toHaveBeenCalledTimes(1)
    );
    // `in`-narrowing, not a cast: the props are a union with the
    // wrong-persona redirect payload, and asserting we did NOT get a
    // redirect is part of what this test is for.
    const props = lastSnapshot().parentWeek?.props;
    if (!props || !('hours' in props)) {
      throw new Error('expected a parentWeek payload, got a redirect');
    }
    expect(props.hours).toBe('8h 15m');
  });

  it('todaysCover does not show a voided entry as a finished session', async () => {
    mockWeekEntries.mockReturnValue({
      data: [
        makeEntry({
          id: 'voided-today',
          status: 'voided',
          local_date: '2026-08-06',
          clock_in_at: '2026-08-06T07:12:00.000Z',
          clock_out_at: '2026-08-06T16:04:00.000Z',
          break_minutes: 30,
        }),
      ],
    });

    renderHookWithProviders(() => useWidgetSnapshotSync());

    await waitFor(() =>
      expect(applyWidgetSnapshotsMock).toHaveBeenCalledTimes(1)
    );
    const cover = lastSnapshot().todaysCover?.props;
    if (!cover || !('rows' in cover)) {
      throw new Error('expected a todaysCover payload, got a redirect');
    }
    expect(cover.rows.some(row => row.kind === 'finished')).toBe(false);
  });
});
