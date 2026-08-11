/**
 * @module domains/today/__tests__/ClockInCard.runningLate.test
 *
 * One-tap "I'm running late" on the off-clock booked/arriving states only.
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
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = 'household-1';
const NANNY_ID = 'user-1';
const TIME_ZONE = 'UTC';
const TODAY = '2026-08-10';
const SHIFT_ID = 'shift-confirmed';

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

const CONFIRMED_SHIFT = makeShift({
  id: SHIFT_ID,
  status: 'confirmed',
  starts_at: '2026-08-10T11:22:00.000Z',
  ends_at: '2026-08-10T19:22:00.000Z',
});

// 05:30 UTC — scheduled (not yet arriving window).
setSystemTime(new Date('2026-08-10T05:30:00.000Z'));
afterAll(() => setSystemTime());

let ClockInCard: typeof import('../components/ClockInCard').ClockInCard;
let mockUseShiftsRange: ReturnType<typeof mock>;
const getRunningMock = mock(() => Promise.resolve(null as unknown));
const clockInMock = mock(() => Promise.resolve(RUNNING_ENTRY));
const clockOutMock = mock(() =>
  Promise.resolve({ ...RUNNING_ENTRY, status: 'submitted' })
);
const sendRunningLateMock = mock(() =>
  Promise.resolve({
    id: 'event-1',
    household_id: HOUSEHOLD_ID,
    shift_id: SHIFT_ID,
    local_date: TODAY,
    actor_id: NANNY_ID,
    event_type: 'running_late',
    payload: {},
    created_at: '2026-08-10T05:30:00.000Z',
  })
);
const mockUseDayThread = mock(() => ({ data: [], isLoading: false }));

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
  }));
  mock.module('@/src/api/endpoints/shifts', () => ({
    shiftApi: {
      sendRunningLate: sendRunningLateMock,
    },
  }));
  mock.module('@/src/hooks/queries/useDayThread', () => ({
    useDayThread: mockUseDayThread,
  }));
  mockUseShiftsRange = mock(() => ({
    data: [CONFIRMED_SHIFT],
    isSuccess: true,
    isError: false,
    isLoading: false,
  }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockUseShiftsRange,
  }));

  const mod = await import('../components/ClockInCard');
  ClockInCard = mod.ClockInCard;
});

beforeEach(() => {
  getRunningMock.mockReset();
  clockInMock.mockReset();
  clockOutMock.mockReset();
  sendRunningLateMock.mockReset();
  mockUseDayThread.mockReset();
  getRunningMock.mockImplementation(() => Promise.resolve(null));
  clockInMock.mockImplementation(() => Promise.resolve(RUNNING_ENTRY));
  clockOutMock.mockImplementation(() =>
    Promise.resolve({ ...RUNNING_ENTRY, status: 'submitted' })
  );
  sendRunningLateMock.mockImplementation(() =>
    Promise.resolve({
      id: 'event-1',
      household_id: HOUSEHOLD_ID,
      shift_id: SHIFT_ID,
      local_date: TODAY,
      actor_id: NANNY_ID,
      event_type: 'running_late',
      payload: {},
      created_at: '2026-08-10T05:30:00.000Z',
    })
  );
  mockUseDayThread.mockReturnValue({ data: [], isLoading: false });
  mockUseShiftsRange.mockReturnValue({
    data: [CONFIRMED_SHIFT],
    isSuccess: true,
    isError: false,
    isLoading: false,
  });
  useAuthStore.setState({
    session: { user: { id: NANNY_ID } } as unknown as never,
    user: { id: NANNY_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ClockInCard — running late', () => {
  it('shows the running-late button only in off-clock scheduled state', async () => {
    const { getByTestId } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(getByTestId('today-off-clock-scheduled')).toBeTruthy();
    expect(getByTestId('today-running-late')).toBeTruthy();
  });

  it('shows the running-late button in off-clock arriving state', async () => {
    setSystemTime(new Date('2026-08-10T10:30:00.000Z'));
    const { getByTestId } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(getByTestId('today-off-clock-arriving')).toBeTruthy();
    expect(getByTestId('today-running-late')).toBeTruthy();
    setSystemTime(new Date('2026-08-10T05:30:00.000Z'));
  });

  it('hides running late when on the clock, when there is no shift, or when declined', async () => {
    getRunningMock.mockImplementation(() => Promise.resolve(RUNNING_ENTRY));
    const onClock = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );
    await waitFor(() =>
      expect(onClock.getByTestId('today-clock-out')).toBeTruthy()
    );
    expect(onClock.queryByTestId('today-running-late')).toBeNull();

    getRunningMock.mockImplementation(() => Promise.resolve(null));
    mockUseShiftsRange.mockReturnValue({
      data: [],
      isSuccess: true,
      isError: false,
      isLoading: false,
    });
    const noShift = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );
    await waitFor(() =>
      expect(noShift.getByTestId('today-clock-in')).toBeTruthy()
    );
    expect(noShift.queryByTestId('today-running-late')).toBeNull();

    mockUseShiftsRange.mockReturnValue({
      data: [
        makeShift({
          id: 'declined-only',
          status: 'declined',
          starts_at: '2026-08-10T06:00:00.000Z',
          ends_at: '2026-08-10T20:00:00.000Z',
        }),
      ],
      isSuccess: true,
      isError: false,
      isLoading: false,
    });
    const declined = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );
    await waitFor(() =>
      expect(declined.getByTestId('today-clock-in')).toBeTruthy()
    );
    expect(declined.queryByTestId('today-running-late')).toBeNull();
  });

  it('tap swaps in confirmation and does not offer a second send', async () => {
    const { getByTestId, getByText, queryByTestId } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    await waitFor(() => expect(getByTestId('today-running-late')).toBeTruthy());
    fireEvent.press(getByTestId('today-running-late'));

    await waitFor(() => {
      expect(sendRunningLateMock).toHaveBeenCalledTimes(1);
      expect(getByTestId('today-running-late-sent')).toBeTruthy();
    });
    expect(queryByTestId('today-running-late')).toBeNull();
    expect(getByTestId('today-running-late-sent')).toBeTruthy();
    expect(getByText('runningLateSent')).toBeTruthy();

    // Confirmation is not a second send affordance.
    expect(queryByTestId('today-running-late')).toBeNull();
    expect(sendRunningLateMock).toHaveBeenCalledTimes(1);
  });
});
