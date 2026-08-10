/**
 * @module domains/today/__tests__/ClockInCard.shiftTruth.test
 *
 * W-B3: one clock control telling the truth — shift meta (status, household,
 * children), multi-household clock-in confirmation, and the post-clock-out
 * receipt the nanny never had.
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
import { localDateInZone } from '@/src/lib/localDate';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = 'household-1';
const HOUSEHOLD_B_ID = 'household-2';
const NANNY_ID = 'user-1';
const TIME_ZONE = 'UTC';

setSystemTime(new Date('2026-08-10T10:00:00.000Z'));
afterAll(() => setSystemTime());

const TODAY = localDateInZone(TIME_ZONE);

function makeShift(overrides: {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  shift_children?: { child_id: string }[];
}) {
  return {
    id: overrides.id,
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
    starts_at: overrides.starts_at,
    ends_at: overrides.ends_at,
    timezone: TIME_ZONE,
    local_date: TODAY,
    kind: 'recurring',
    status: overrides.status,
    source_pattern_id: null,
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: overrides.id,
    sequence: 0,
    created_by: NANNY_ID,
    created_at: overrides.starts_at,
    updated_at: overrides.starts_at,
    shift_children: overrides.shift_children,
  };
}

function makeEntry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    id: 'entry-1',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
    carer_display_name: 'Nanny',
    shift_id: null,
    clock_in_at: `${TODAY}T08:00:00.000Z`,
    clock_out_at: `${TODAY}T16:00:00.000Z`,
    break_minutes: 0,
    scheduled_minutes: null,
    kind: 'worked',
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: 'submitted',
    local_date: TODAY,
    timezone: TIME_ZONE,
    created_at: `${TODAY}T08:00:00.000Z`,
    updated_at: `${TODAY}T16:00:00.000Z`,
    ...overrides,
  };
}

const RUNNING_ENTRY = {
  id: 'entry-running',
  household_id: HOUSEHOLD_ID,
  carer_id: NANNY_ID,
  clock_in_at: '2026-08-10T09:00:00.000Z',
  status: 'running',
};

let ClockInCard: typeof import('../components/ClockInCard').ClockInCard;
let mockUseShiftsRange: ReturnType<typeof mock>;
let mockUseActiveHousehold: ReturnType<typeof mock>;
let mockUseChildren: ReturnType<typeof mock>;
let mockUseWeekTimeEntries: ReturnType<typeof mock>;
const getRunningMock = mock(() => Promise.resolve(null as unknown));

beforeAll(async () => {
  mock.module('@/lib/animations/useReducedMotion', () => ({
    useReducedMotion: mock(() => false),
  }));
  mock.module('@/lib/useColorScheme', () => ({
    useColorScheme: () => ({
      colorScheme: 'light' as const,
      isDarkColorScheme: false,
      setColorScheme: () => {},
      toggleColorScheme: () => {},
    }),
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        options ? `${key}::${JSON.stringify(options)}` : key,
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mock.module('@/src/api/endpoints/timeEntries', () => ({
    timeEntryApi: {
      getRunning: getRunningMock,
      clockIn: mock(() => Promise.resolve(RUNNING_ENTRY)),
      clockOut: mock(() =>
        Promise.resolve({ ...RUNNING_ENTRY, status: 'submitted' })
      ),
    },
  }));

  mockUseShiftsRange = mock(() => ({
    data: [] as unknown[],
    isSuccess: true,
    isError: false,
    isLoading: false,
  }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockUseShiftsRange,
  }));

  mockUseActiveHousehold = mock(() => ({
    households: [{ id: HOUSEHOLD_ID, name: 'Smith Family' }],
    household: { id: HOUSEHOLD_ID, name: 'Smith Family' },
    householdId: HOUSEHOLD_ID,
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId: mock(),
    isLoading: false,
    isError: false,
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: mockUseActiveHousehold,
  }));

  mockUseChildren = mock(() => ({
    data: [
      { id: 'child-1', name: 'Emma Smith', household_id: HOUSEHOLD_ID },
      { id: 'child-2', name: 'Liam Smith', household_id: HOUSEHOLD_ID },
    ],
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: mockUseChildren,
  }));

  mockUseWeekTimeEntries = mock(() => ({ data: [] as TimeEntry[] }));
  mock.module('@/src/hooks/queries/useWeekTimeEntries', () => ({
    useWeekTimeEntries: mockUseWeekTimeEntries,
  }));

  const mod = await import('../components/ClockInCard');
  ClockInCard = mod.ClockInCard;
});

beforeEach(() => {
  getRunningMock.mockReset();
  getRunningMock.mockImplementation(() => Promise.resolve(null));
  mockUseShiftsRange.mockReturnValue({
    data: [],
    isSuccess: true,
    isError: false,
    isLoading: false,
  });
  mockUseActiveHousehold.mockReturnValue({
    households: [{ id: HOUSEHOLD_ID, name: 'Smith Family' }],
    household: { id: HOUSEHOLD_ID, name: 'Smith Family' },
    householdId: HOUSEHOLD_ID,
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId: mock(),
    isLoading: false,
    isError: false,
  });
  mockUseChildren.mockReturnValue({
    data: [
      { id: 'child-1', name: 'Emma Smith', household_id: HOUSEHOLD_ID },
      { id: 'child-2', name: 'Liam Smith', household_id: HOUSEHOLD_ID },
    ],
  });
  mockUseWeekTimeEntries.mockReturnValue({ data: [] });
  useAuthStore.setState({
    session: { user: { id: NANNY_ID } } as unknown as never,
    user: { id: NANNY_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ClockInCard — shift meta under the hero', () => {
  it('shows pending status and child first names on the meta line', async () => {
    mockUseShiftsRange.mockReturnValue({
      data: [
        makeShift({
          id: 'shift-pending',
          status: 'pending',
          starts_at: '2026-08-10T11:00:00.000Z',
          ends_at: '2026-08-10T19:00:00.000Z',
          shift_children: [{ child_id: 'child-1' }, { child_id: 'child-2' }],
        }),
      ],
      isSuccess: true,
      isError: false,
      isLoading: false,
    });

    const { getByTestId, getByText } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        householdName="Smith Family"
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(getByText('awaitingYourAnswer · Emma, Liam')).toBeTruthy();
  });

  it('shows confirmed status on the meta line', async () => {
    mockUseShiftsRange.mockReturnValue({
      data: [
        makeShift({
          id: 'shift-confirmed',
          status: 'confirmed',
          starts_at: '2026-08-10T11:00:00.000Z',
          ends_at: '2026-08-10T19:00:00.000Z',
        }),
      ],
      isSuccess: true,
      isError: false,
      isLoading: false,
    });

    const { getByTestId, getByText } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(getByText('coverage.status.confirmed')).toBeTruthy();
  });

  it('omits household from meta when the account has only one household', async () => {
    mockUseShiftsRange.mockReturnValue({
      data: [
        makeShift({
          id: 'shift-confirmed',
          status: 'confirmed',
          starts_at: '2026-08-10T11:00:00.000Z',
          ends_at: '2026-08-10T19:00:00.000Z',
        }),
      ],
      isSuccess: true,
      isError: false,
      isLoading: false,
    });

    const { getByTestId, getByText, queryByText } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        householdName="Smith Family"
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(getByText('coverage.status.confirmed')).toBeTruthy();
    // A single-household account must not have the family's name appended —
    // it is noise when there is only one family it could be.
    expect(queryByText(/Smith Family/)).toBeNull();
  });

  it('includes household on the meta line for multi-household accounts', async () => {
    mockUseActiveHousehold.mockReturnValue({
      households: [
        { id: HOUSEHOLD_ID, name: 'Smith Family' },
        { id: HOUSEHOLD_B_ID, name: 'Jones Family' },
      ],
      household: { id: HOUSEHOLD_ID, name: 'Smith Family' },
      householdId: HOUSEHOLD_ID,
      pastHouseholds: [],
      isPastHousehold: false,
      setActiveHouseholdId: mock(),
      isLoading: false,
      isError: false,
    });
    mockUseShiftsRange.mockReturnValue({
      data: [
        makeShift({
          id: 'shift-confirmed',
          status: 'confirmed',
          starts_at: '2026-08-10T11:00:00.000Z',
          ends_at: '2026-08-10T19:00:00.000Z',
        }),
      ],
      isSuccess: true,
      isError: false,
      isLoading: false,
    });

    const { getByTestId, getByText } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        householdName="Smith Family"
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(getByText('coverage.status.confirmed · Smith Family')).toBeTruthy();
  });
});

describe('ClockInCard — multi-household clock-in confirmation', () => {
  it('names the household under the timer when on the clock with 2+ households', async () => {
    mockUseActiveHousehold.mockReturnValue({
      households: [
        { id: HOUSEHOLD_ID, name: 'Smith Family' },
        { id: HOUSEHOLD_B_ID, name: 'Jones Family' },
      ],
      household: { id: HOUSEHOLD_ID, name: 'Smith Family' },
      householdId: HOUSEHOLD_ID,
      pastHouseholds: [],
      isPastHousehold: false,
      setActiveHouseholdId: mock(),
      isLoading: false,
      isError: false,
    });
    getRunningMock.mockImplementation(() => Promise.resolve(RUNNING_ENTRY));

    const { getByTestId, getByText } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        householdName="Smith Family"
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    expect(
      getByText(/clockedIntoHousehold::\{"household":"Smith Family"\}/)
    ).toBeTruthy();
  });

  it('hides the household line on the clock when there is only one household', async () => {
    getRunningMock.mockImplementation(() => Promise.resolve(RUNNING_ENTRY));

    const { getByTestId, queryByText } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        householdName="Smith Family"
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    expect(queryByText(/clockedIntoHousehold::/)).toBeNull();
  });
});

describe('ClockInCard — clocked-out receipt', () => {
  it('shows a positive receipt after the last entry today has ended', async () => {
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          id: 'entry-done',
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: `${TODAY}T12:00:00.000Z`,
          break_minutes: 0,
        }),
      ],
    });

    const { getByTestId, getByText } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(
      getByText(/liveActivity\.receiptTitle::\{"time":"12:00 PM"\}/)
    ).toBeTruthy();
    expect(
      getByText(/liveActivity\.receiptBody::\{"duration":"4h"\}/)
    ).toBeTruthy();
    expect(getByTestId('today-clock-receipt')).toBeTruthy();
  });

  it('uses receiptBodyWithBreak when break_minutes > 0', async () => {
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          id: 'entry-break',
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: `${TODAY}T13:00:00.000Z`,
          break_minutes: 30,
        }),
      ],
    });

    const { getByTestId, getByText } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(
      getByText(
        /liveActivity\.receiptBodyWithBreak::\{"duration":"4h 30m","breakDuration":"30m"\}/
      )
    ).toBeTruthy();
  });

  it('excludes voided entries from the receipt', async () => {
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        makeEntry({
          id: 'entry-voided',
          status: 'voided',
          clock_in_at: `${TODAY}T08:00:00.000Z`,
          clock_out_at: `${TODAY}T16:00:00.000Z`,
        }),
      ],
    });

    const { getByTestId, queryByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(queryByTestId('today-clock-receipt')).toBeNull();
  });
});

describe('ClockInCard — child names stay distinguishable', () => {
  it('falls back to full names when first names collide', async () => {
    // Siblings entered as "H1 Child1"/"H1 Child2" truncate to "H1, H1" — a
    // line whose one job is to say WHICH children, saying nothing. Real
    // fixtures do this, and so will any family who prefixes their kids' names.
    mockUseChildren.mockReturnValue({
      data: [
        { id: 'child-1', name: 'H1 Child1' },
        { id: 'child-2', name: 'H1 Child2' },
      ],
      isLoading: false,
    });
    mockUseShiftsRange.mockReturnValue({
      data: [
        makeShift({
          id: 'shift-confirmed',
          status: 'confirmed',
          starts_at: '2026-08-10T11:00:00.000Z',
          ends_at: '2026-08-10T19:00:00.000Z',
          shift_children: [{ child_id: 'child-1' }, { child_id: 'child-2' }],
        }),
      ],
      isSuccess: true,
      isError: false,
      isLoading: false,
    });

    const { getByTestId, getByText, queryByText } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(queryByText(/H1, H1/)).toBeNull();
    expect(getByText(/H1 Child1, H1 Child2/)).toBeTruthy();
  });
});
