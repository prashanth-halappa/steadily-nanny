/**
 * @module domains/today/__tests__/ClockInCard.clockout
 *
 * D20 — `ClockInCard`'s clock-out call site sent no input at all, so
 * `break_minutes` was permanently 0 and `note` permanently null while the
 * server's `computeWorkedMinutes` faithfully subtracted a break it never
 * received: every genuine unpaid break was recorded as worked time.
 *
 * Renders the real `ClockInCard` against a real `QueryClient`, with only
 * the API leaf (`timeEntryApi`) mocked — same shape as
 * `ClockInCard.behavior.test.tsx` (D7) — so this proves the real card wires
 * real entered values through to the real network call, not a mocked
 * callback standing in for the component (the standard this run was
 * burned by once on D15, per the team-lead brief).
 *
 * Overlap refusal (409 TIME_ENTRY_OVERLAPS): clock-out can now fail with the
 * entry still `running`. The toast must name the conflicting entry id so the
 * carer can find it on Hours, and the sheet must stay open with the typed
 * break/note intact (optimistic clear must not wipe the draft).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';
import { ClockInCard } from '../components/ClockInCard';

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

const HOUSEHOLD_ID = 'household-1';
const OVERLAPPING_ENTRY_ID = 'entry-overlap-42';
// Two hours ago, relative to the real clock. NOT a hardcoded instant: the
// card's forgotten-clock-out state (Daylight UX #7) triggers off elapsed
// time, so a fixed past date would silently drift into "overdue" and change
// what this file is testing. `ClockInCard.overdue.test.tsx` covers that
// state deliberately.
const RECENT_CLOCK_IN = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const RUNNING_ENTRY = {
  id: 'entry-1',
  household_id: HOUSEHOLD_ID,
  clock_in_at: RECENT_CLOCK_IN,
  status: 'running',
};

const TIME_ENTRY_OVERLAPS_ERROR = {
  isAxiosError: true,
  response: {
    status: 409,
    data: {
      error: {
        code: 'CONFLICT',
        metadata: {
          reason: 'TIME_ENTRY_OVERLAPS',
          overlappingEntryId: OVERLAPPING_ENTRY_ID,
        },
      },
    },
  },
};

const getRunningMock = mock(() => Promise.resolve<unknown>(RUNNING_ENTRY));
const clockOutMock = mock(() =>
  Promise.resolve({ ...RUNNING_ENTRY, status: 'submitted' })
);
const showErrorToastMock = mock((..._args: unknown[]) => {});

mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: {
    getRunning: getRunningMock,
    clockIn: mock(),
    clockOut: clockOutMock,
  },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: mock(),
  showInfoToast: mock(),
  showWarningToast: mock(),
  useToast: () => ({ show: mock() }),
}));

beforeEach(() => {
  getRunningMock.mockReset();
  clockOutMock.mockReset();
  showErrorToastMock.mockReset();
  getRunningMock.mockImplementation(() => Promise.resolve(RUNNING_ENTRY));
  clockOutMock.mockImplementation(() =>
    Promise.resolve({ ...RUNNING_ENTRY, status: 'submitted' })
  );
  useAuthStore.setState({
    session: { user: { id: 'user-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ClockInCard — D20 break minutes at clock-out', () => {
  it('tapping Clock out opens the sheet without calling the API yet', async () => {
    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" />
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    fireEvent.press(getByTestId('today-clock-out'));

    await waitFor(() => expect(getByTestId('clockout-confirm')).toBeTruthy());
    expect(clockOutMock).not.toHaveBeenCalled();
  });

  it('confirming immediately (fast skip) clocks out with no break and no note', async () => {
    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" />
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    fireEvent.press(getByTestId('today-clock-out'));

    await waitFor(() => expect(getByTestId('clockout-confirm')).toBeTruthy());
    fireEvent.press(getByTestId('clockout-confirm'));

    await waitFor(() => expect(clockOutMock).toHaveBeenCalledTimes(1));
    expect(clockOutMock).toHaveBeenCalledWith('entry-1', {});
  });

  it('picking a break chip sends break_minutes to the real clock-out call', async () => {
    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" />
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    fireEvent.press(getByTestId('today-clock-out'));

    await waitFor(() => expect(getByTestId('clockout-break-30')).toBeTruthy());
    fireEvent.press(getByTestId('clockout-break-30'));
    fireEvent.press(getByTestId('clockout-confirm'));

    await waitFor(() => expect(clockOutMock).toHaveBeenCalledTimes(1));
    expect(clockOutMock).toHaveBeenCalledWith('entry-1', { break_minutes: 30 });
  });

  it('a break plus a note both reach the real clock-out call', async () => {
    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" />
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    fireEvent.press(getByTestId('today-clock-out'));

    await waitFor(() => expect(getByTestId('clockout-break-15')).toBeTruthy());
    fireEvent.press(getByTestId('clockout-break-15'));
    fireEvent.changeText(getByTestId('clockout-note'), 'covered pickup');
    fireEvent.press(getByTestId('clockout-confirm'));

    await waitFor(() => expect(clockOutMock).toHaveBeenCalledTimes(1));
    expect(clockOutMock).toHaveBeenCalledWith('entry-1', {
      break_minutes: 15,
      note: 'covered pickup',
    });
  });

  it('after a successful clock-out the sheet closes and the card returns to the clock-in prompt', async () => {
    let getRunningCalls = 0;
    getRunningMock.mockImplementation(() => {
      getRunningCalls += 1;
      return Promise.resolve(getRunningCalls === 1 ? RUNNING_ENTRY : null);
    });

    const { getByTestId, queryByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" />
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    fireEvent.press(getByTestId('today-clock-out'));

    await waitFor(() => expect(getByTestId('clockout-confirm')).toBeTruthy());
    fireEvent.press(getByTestId('clockout-confirm'));

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(queryByTestId('clockout-sheet')).toBeNull();
    expect(queryByTestId('today-live-timer')).toBeNull();
  });

  it('a rapid double-tap on confirm issues exactly one clock-out request', async () => {
    clockOutMock.mockImplementation(() => new Promise(() => {}));

    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" />
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    fireEvent.press(getByTestId('today-clock-out'));

    await waitFor(() => expect(getByTestId('clockout-confirm')).toBeTruthy());
    const confirmButton = getByTestId('clockout-confirm');
    fireEvent.press(confirmButton);
    fireEvent.press(confirmButton);

    await waitFor(() => expect(clockOutMock).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(clockOutMock).toHaveBeenCalledTimes(1);
  });

  it('a 409 TIME_ENTRY_OVERLAPS toast names the conflicting entry and keeps the sheet open with the typed draft', async () => {
    clockOutMock.mockImplementationOnce(() =>
      Promise.reject(TIME_ENTRY_OVERLAPS_ERROR)
    );

    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" />
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    fireEvent.press(getByTestId('today-clock-out'));

    await waitFor(() => expect(getByTestId('clockout-break-30')).toBeTruthy());
    fireEvent.press(getByTestId('clockout-break-30'));
    fireEvent.changeText(getByTestId('clockout-note'), 'covered pickup');
    fireEvent.press(getByTestId('clockout-confirm'));

    await waitFor(() => expect(clockOutMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        showErrorToastMock.mock.calls.some(call =>
          String(call[0] ?? '').includes(OVERLAPPING_ENTRY_ID)
        )
      ).toBe(true)
    );

    // Sheet stays open — only success closes it — and the typed break/note
    // survive the optimistic clear + refusal (otherwise she'd retype mid-shift).
    expect(getByTestId('clockout-sheet')).toBeTruthy();
    expect(getByTestId('clockout-break-custom').props.value).toBe('30');
    expect(getByTestId('clockout-note').props.value).toBe('covered pickup');
  });

  it('a generic clock-out failure still leaves the sheet open with the typed draft, without an overlap toast', async () => {
    clockOutMock.mockImplementationOnce(() =>
      Promise.reject({
        isAxiosError: true,
        response: {
          status: 500,
          data: { error: { code: 'INTERNAL_ERROR' } },
        },
      })
    );

    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" />
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    fireEvent.press(getByTestId('today-clock-out'));

    await waitFor(() => expect(getByTestId('clockout-break-15')).toBeTruthy());
    fireEvent.press(getByTestId('clockout-break-15'));
    fireEvent.changeText(getByTestId('clockout-note'), 'late handover');
    fireEvent.press(getByTestId('clockout-confirm'));

    await waitFor(() => expect(clockOutMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(showErrorToastMock).toHaveBeenCalled());

    expect(
      showErrorToastMock.mock.calls.some(call =>
        String(call[0] ?? '').includes(OVERLAPPING_ENTRY_ID)
      )
    ).toBe(false);
    expect(getByTestId('clockout-sheet')).toBeTruthy();
    expect(getByTestId('clockout-break-custom').props.value).toBe('15');
    expect(getByTestId('clockout-note').props.value).toBe('late handover');
  });
});
