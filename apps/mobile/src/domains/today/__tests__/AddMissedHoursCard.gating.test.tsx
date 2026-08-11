/**
 * @module domains/today/__tests__/AddMissedHoursCard.gating
 *
 * The missed-hours CTA is helpful only when she has a covering shift this
 * week with no time entry on that day — not a permanent accusation.
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
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { TimeEntry } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { render } from '@testing-library/react-native';
import { localDateInZone } from '@/src/lib/localDate';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const NANNY_ID = '33333333-3333-4333-8333-333333333333';
const TIME_ZONE = 'UTC';

setSystemTime(new Date('2026-08-06T12:00:00.000Z'));
afterAll(() => setSystemTime());

const TODAY = localDateInZone(TIME_ZONE);

let AddMissedHoursCard: typeof import('../components/AddMissedHoursCard').AddMissedHoursCard;
let mockUseWeekTimeEntries: ReturnType<typeof mock>;
let mockUseShiftsRange: ReturnType<typeof mock>;

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
    kind: 'recurring',
    status: 'confirmed',
    timezone: TIME_ZONE,
    local_date: TODAY,
    starts_at: `${TODAY}T09:00:00.000Z`,
    ends_at: `${TODAY}T17:00:00.000Z`,
    source_pattern_id: null,
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'uid-1',
    sequence: 0,
    created_by: null,
    created_at: `${TODAY}T00:00:00.000Z`,
    updated_at: `${TODAY}T00:00:00.000Z`,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'entry-1',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
    carer_display_name: 'Ines',
    shift_id: null,
    clock_in_at: `${TODAY}T09:00:00.000Z`,
    clock_out_at: `${TODAY}T17:00:00.000Z`,
    break_minutes: 0,
    scheduled_minutes: null,
    kind: 'worked',
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: 'submitted',
    local_date: TODAY,
    timezone: TIME_ZONE,
    created_at: `${TODAY}T17:00:00.000Z`,
    updated_at: `${TODAY}T17:00:00.000Z`,
    ...overrides,
  };
}

beforeAll(async () => {
  mock.module('@/src/hooks/mutations/useCreateRetroactiveEntry', () => ({
    useCreateRetroactiveEntry: () => ({
      mutateAsync: mock(() => Promise.resolve(makeEntry())),
      isPending: false,
    }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: mock((selector: (s: unknown) => unknown) =>
      selector({ user: { id: NANNY_ID } })
    ),
  }));
  mockUseWeekTimeEntries = mock(() => ({
    data: [],
    isLoading: false,
    isPending: false,
  }));
  mockUseShiftsRange = mock(() => ({
    data: [makeShift()],
    isLoading: false,
    isPending: false,
  }));
  mock.module('@/src/hooks/queries/useWeekTimeEntries', () => ({
    useWeekTimeEntries: mockUseWeekTimeEntries,
  }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockUseShiftsRange,
  }));

  AddMissedHoursCard = (await import('../components/AddMissedHoursCard'))
    .AddMissedHoursCard;
});

beforeEach(() => {
  mockUseWeekTimeEntries.mockImplementation(() => ({
    data: [],
    isLoading: false,
    isPending: false,
  }));
  mockUseShiftsRange.mockImplementation(() => ({
    data: [makeShift()],
    isLoading: false,
    isPending: false,
  }));
});

describe('AddMissedHoursCard gating', () => {
  it('renders the CTA when a covering shift day has no time entry', () => {
    const { getByTestId } = render(
      <AddMissedHoursCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );
    expect(getByTestId('today-missed-hours-cta')).toBeTruthy();
  });

  it('renders nothing when every covering shift day already has an entry', () => {
    mockUseWeekTimeEntries.mockImplementation(() => ({
      data: [makeEntry()],
      isLoading: false,
      isPending: false,
    }));
    const { queryByTestId } = render(
      <AddMissedHoursCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );
    expect(queryByTestId('today-missed-hours-cta')).toBeNull();
  });

  it('renders nothing when the only shifts are non-covering statuses', () => {
    mockUseShiftsRange.mockImplementation(() => ({
      data: [
        makeShift({ status: 'declined' }),
        makeShift({ id: 'shift-2', status: 'cancelled' }),
        makeShift({ id: 'shift-3', status: 'draft' }),
      ],
      isLoading: false,
      isPending: false,
    }));
    const { queryByTestId } = render(
      <AddMissedHoursCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );
    expect(queryByTestId('today-missed-hours-cta')).toBeNull();
  });

  it('renders nothing while shift or entry queries are loading', () => {
    mockUseWeekTimeEntries.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
      isPending: true,
    }));
    const { queryByTestId } = render(
      <AddMissedHoursCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );
    expect(queryByTestId('today-missed-hours-cta')).toBeNull();
  });
});
