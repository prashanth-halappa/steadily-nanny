/**
 * @module domains/today/__tests__/ClockInCard.offClockShift.test
 *
 * Wave 2-A off-clock shift selection: SCHEDULED_SHIFT_STATUSES filter,
 * next-not-earliest pick, declined-today state, and no schedule claims
 * while the shifts query is in flight.
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
import {
  TIME_ENTRY_KINDS,
  TIME_ENTRY_STATUSES,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = 'household-1';
const NANNY_ID = 'user-1';
const TIME_ZONE = 'UTC';
const TODAY = '2026-08-10';

// 05:30 UTC — before the declined 06:00 shift and the confirmed 11:22 shift.
setSystemTime(new Date('2026-08-10T05:30:00.000Z'));
afterAll(() => setSystemTime());

const RUNNING_ENTRY = {
  id: 'entry-1',
  household_id: HOUSEHOLD_ID,
  clock_in_at: '2026-08-10T08:00:00.000Z',
  status: 'running',
};

function makeShift(overrides: {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string;
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
  };
}

const BUG_SCENARIO_SHIFTS = [
  makeShift({
    id: 'shift-declined',
    status: 'declined',
    starts_at: '2026-08-10T06:00:00.000Z',
    ends_at: '2026-08-10T20:00:00.000Z',
  }),
  makeShift({
    id: 'shift-cancelled-1',
    status: 'cancelled',
    starts_at: '2026-08-10T07:00:00.000Z',
    ends_at: '2026-08-10T15:00:00.000Z',
  }),
  makeShift({
    id: 'shift-cancelled-2',
    status: 'cancelled',
    starts_at: '2026-08-10T08:00:00.000Z',
    ends_at: '2026-08-10T16:00:00.000Z',
  }),
  makeShift({
    id: 'shift-confirmed',
    status: 'confirmed',
    starts_at: '2026-08-10T11:22:00.000Z',
    ends_at: '2026-08-10T19:22:00.000Z',
  }),
];

let ClockInCard: typeof import('../components/ClockInCard').ClockInCard;
let mockUseShiftsRange: ReturnType<typeof mock>;
let mockUseWeekTimeEntries: ReturnType<typeof mock>;
const missedShiftMutateAsync = mock(() => Promise.resolve({}));
const getRunningMock = mock(() => Promise.resolve(null as unknown));
const clockInMock = mock(() => Promise.resolve(RUNNING_ENTRY));
const clockOutMock = mock(() =>
  Promise.resolve({ ...RUNNING_ENTRY, status: 'submitted' })
);

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
      clockIn: clockInMock,
      clockOut: clockOutMock,
    },
    // §11.1's `earningsStructureLine` chain pulls these re-exported
    // constants in transitively — real, pure, sync values, so this mock
    // stays a complete stand-in instead of throwing on a named export it
    // never provided.
    TIME_ENTRY_KINDS,
    TIME_ENTRY_STATUSES,
  }));
  mockUseShiftsRange = mock(() => ({
    data: BUG_SCENARIO_SHIFTS,
    isSuccess: true,
    isError: false,
    isLoading: false,
  }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockUseShiftsRange,
  }));
  mockUseWeekTimeEntries = mock(() => ({
    data: [],
    isSuccess: true,
    isError: false,
    isLoading: false,
  }));
  mock.module('@/src/hooks/queries/useWeekTimeEntries', () => ({
    useWeekTimeEntries: mockUseWeekTimeEntries,
  }));
  // MissedHoursSheet's own mutation — a spy so a test can assert the sheet
  // opened WITHOUT submitting anything on her behalf.
  mock.module('@/src/hooks/mutations/useCreateRetroactiveEntry', () => ({
    useCreateRetroactiveEntry: () => ({
      mutateAsync: missedShiftMutateAsync,
      isPending: false,
    }),
  }));

  const mod = await import('../components/ClockInCard');
  ClockInCard = mod.ClockInCard;
});

beforeEach(() => {
  getRunningMock.mockReset();
  clockInMock.mockReset();
  clockOutMock.mockReset();
  getRunningMock.mockImplementation(() => Promise.resolve(null));
  clockInMock.mockImplementation(() => Promise.resolve(RUNNING_ENTRY));
  clockOutMock.mockImplementation(() =>
    Promise.resolve({ ...RUNNING_ENTRY, status: 'submitted' })
  );
  mockUseShiftsRange.mockReturnValue({
    data: BUG_SCENARIO_SHIFTS,
    isSuccess: true,
    isError: false,
    isLoading: false,
  });
  mockUseWeekTimeEntries.mockReturnValue({
    data: [],
    isSuccess: true,
    isError: false,
    isLoading: false,
  });
  missedShiftMutateAsync.mockReset();
  missedShiftMutateAsync.mockImplementation(() => Promise.resolve({}));
  useAuthStore.setState({
    session: { user: { id: NANNY_ID } } as unknown as never,
    user: { id: NANNY_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ClockInCard — off-clock shift selection', () => {
  it('ignores declined/cancelled shifts and shows the confirmed window on the hero', async () => {
    const { getByTestId, queryByTestId, getByText } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());

    expect(queryByTestId('today-off-clock-arriving')).toBeNull();
    expect(getByTestId('today-off-clock-scheduled')).toBeTruthy();
    expect(
      getByText(/nannyScheduledBody::\{"start":"11:22 AM","end":"7:22 PM"\}/)
    ).toBeTruthy();
    expect(
      getByTestId('today-clock-in').props.accessibilityState?.disabled
    ).not.toBe(true);
  });

  it('names a declined shift on a secondary line when a covering shift wins the hero', async () => {
    const { getByTestId, getByText } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());

    expect(
      getByText(/declinedToday::\{"start":"6:00 AM","end":"8:00 PM"\}/)
    ).toBeTruthy();
  });

  it('shows declined-today hero when every shift today was declined or cancelled', async () => {
    mockUseShiftsRange.mockReturnValue({
      data: [
        makeShift({
          id: 'shift-declined-only',
          status: 'declined',
          starts_at: '2026-08-10T06:00:00.000Z',
          ends_at: '2026-08-10T20:00:00.000Z',
        }),
        makeShift({
          id: 'shift-cancelled-only',
          status: 'cancelled',
          starts_at: '2026-08-10T08:00:00.000Z',
          ends_at: '2026-08-10T16:00:00.000Z',
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
        weekStartsOn={1}
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());

    expect(getByTestId('today-off-clock-declined')).toBeTruthy();
    expect(
      getByText(/declinedToday::\{"start":"6:00 AM","end":"8:00 PM"\}/)
    ).toBeTruthy();
    expect(getByText('declinedTodayHint')).toBeTruthy();
  });

  it('does not claim nothing is scheduled while shifts are still loading', async () => {
    mockUseShiftsRange.mockReturnValue({
      data: undefined,
      isSuccess: false,
      isError: false,
      isLoading: true,
    });

    const { getByTestId, queryByTestId, getByText, queryByText } =
      renderWithProviders(
        <ClockInCard
          householdId={HOUSEHOLD_ID}
          timeZone={TIME_ZONE}
          weekStartsOn={1}
        />
      );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());

    // The CLAIM is what must wait for the query, not the whole card. Blanking
    // the hero while loading also hides "Ready when you are", which is an
    // invitation that is true in every state — so she'd stare at an empty card
    // on a slow connection. The hero stays; only "Nothing's scheduled today"
    // is withheld until the query has actually answered.
    expect(getByTestId('today-off-clock-none').props.children).toBe(
      'readyWhenYouAre'
    );
    expect(queryByTestId('today-off-clock-scheduled')).toBeNull();
    expect(queryByTestId('today-off-clock-arriving')).toBeNull();
    expect(queryByTestId('today-off-clock-declined')).toBeNull();
    expect(queryByText('clockInHintNoShift')).toBeNull();
    expect(getByText('clockInHint')).toBeTruthy();
  });

  it('claims nothing is scheduled only once the query has answered', async () => {
    mockUseShiftsRange.mockReturnValue({
      data: [],
      isSuccess: true,
      isError: false,
      isLoading: false,
    });

    const { getByTestId, getByText } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(getByText('clockInHintNoShift')).toBeTruthy();
  });

  it('never gates clock-in on the shifts query', async () => {
    // A slow or failed schedule fetch must not cost her an hour of pay:
    // "if I'm in the house working, I'm working".
    mockUseShiftsRange.mockReturnValue({
      data: undefined,
      isSuccess: false,
      isError: false,
      isLoading: true,
    });

    const { getByTestId } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    // The label renders (rather than the loading dots) only when the button
    // is genuinely actionable.
    expect(getByTestId('today-clock-in-label')).toBeTruthy();
  });

  it('distinguishes an already-ended, unclocked shift from an upcoming one', async () => {
    // Ends at 05:00 — before "now" (05:30) — and nothing was ever clocked
    // against it (no time-entry mock is wired for this file, so
    // useWeekTimeEntries resolves with no data either way).
    mockUseShiftsRange.mockReturnValue({
      data: [
        makeShift({
          id: 'shift-missed',
          status: 'confirmed',
          starts_at: '2026-08-10T02:00:00.000Z',
          ends_at: '2026-08-10T05:00:00.000Z',
        }),
      ],
      isSuccess: true,
      isError: false,
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());

    // A distinct past-tense state, not the same "scheduled" hero an upcoming
    // shift renders through.
    expect(getByTestId('today-off-clock-missed')).toBeTruthy();
    expect(queryByTestId('today-off-clock-scheduled')).toBeNull();
    expect(queryByTestId('today-off-clock-arriving')).toBeNull();
    // And she can act on it right here, without a second form to fill in —
    // the shift's own times are already known.
    expect(getByTestId('today-log-missed-shift')).toBeTruthy();
  });

  it('opens a sheet prefilled with the shift times on tap, and never submits on her behalf', async () => {
    mockUseShiftsRange.mockReturnValue({
      data: [
        makeShift({
          id: 'shift-missed-prefill',
          status: 'confirmed',
          starts_at: '2026-08-10T02:00:00.000Z',
          ends_at: '2026-08-10T05:00:00.000Z',
        }),
      ],
      isSuccess: true,
      isError: false,
      isLoading: false,
    });

    const { getByTestId } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    fireEvent.press(getByTestId('today-log-missed-shift'));

    await waitFor(() =>
      expect(getByTestId('today-missed-hours-sheet')).toBeTruthy()
    );
    // Prefilled from the shift's own schedule — the scheduled window is a
    // suggestion here, never a fact recorded without her confirming it.
    expect(getByTestId('today-missed-hours-times-start').props.value).toEqual(
      new Date(2000, 0, 1, 2, 0, 0, 0)
    );
    expect(getByTestId('today-missed-hours-times-end').props.value).toEqual(
      new Date(2000, 0, 1, 5, 0, 0, 0)
    );
    // Opening the sheet must never itself be a money write.
    expect(missedShiftMutateAsync).not.toHaveBeenCalled();
  });

  it('still surfaces a missed morning shift after she clocks in for a later shift the same day', async () => {
    mockUseShiftsRange.mockReturnValue({
      data: [
        makeShift({
          id: 'shift-missed-morning',
          status: 'confirmed',
          starts_at: '2026-08-10T02:00:00.000Z',
          ends_at: '2026-08-10T05:00:00.000Z',
        }),
        makeShift({
          id: 'shift-evening',
          status: 'confirmed',
          starts_at: '2026-08-10T17:00:00.000Z',
          ends_at: '2026-08-10T19:00:00.000Z',
        }),
      ],
      isSuccess: true,
      isError: false,
      isLoading: false,
    });
    // A real, submitted entry for TODAY — but it covers the evening shift,
    // not the missed morning one. Day-scoping alone would hide the missed
    // shift the instant this exists; the check has to be per-shift.
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        {
          id: 'entry-evening',
          household_id: HOUSEHOLD_ID,
          carer_id: NANNY_ID,
          local_date: TODAY,
          status: 'submitted',
          clock_in_at: '2026-08-10T17:00:00.000Z',
          clock_out_at: '2026-08-10T19:00:00.000Z',
        },
      ],
      isSuccess: true,
      isError: false,
      isLoading: false,
    });

    const { getByTestId } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(getByTestId('today-off-clock-missed')).toBeTruthy();
  });

  it('does not let a null clock_in_at entry mask an ended, unlogged shift', async () => {
    // An entry with no clock_in_at never logged work. Feeding null into
    // `new Date` coerces to epoch, which would overlap every shift and hide
    // the missed state — the exact bug shiftIsCovered exists to prevent.
    mockUseShiftsRange.mockReturnValue({
      data: [
        makeShift({
          id: 'shift-missed-null-entry',
          status: 'confirmed',
          starts_at: '2026-08-10T02:00:00.000Z',
          ends_at: '2026-08-10T05:00:00.000Z',
        }),
      ],
      isSuccess: true,
      isError: false,
      isLoading: false,
    });
    mockUseWeekTimeEntries.mockReturnValue({
      data: [
        {
          id: 'entry-null-clock-in',
          household_id: HOUSEHOLD_ID,
          carer_id: NANNY_ID,
          local_date: TODAY,
          status: 'submitted',
          clock_in_at: null,
          clock_out_at: '2026-08-10T05:00:00.000Z',
        },
      ],
      isSuccess: true,
      isError: false,
      isLoading: false,
    });

    const { getByTestId } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(getByTestId('today-off-clock-missed')).toBeTruthy();
  });
});
