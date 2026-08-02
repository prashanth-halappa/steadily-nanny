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
const RUNNING_ENTRY = {
  id: 'entry-1',
  household_id: HOUSEHOLD_ID,
  clock_in_at: '2026-08-01T20:00:00.000Z',
  status: 'running',
};

const getRunningMock = mock(() => Promise.resolve<unknown>(RUNNING_ENTRY));
const clockOutMock = mock(() =>
  Promise.resolve({ ...RUNNING_ENTRY, status: 'submitted' })
);

mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: {
    getRunning: getRunningMock,
    clockIn: mock(),
    clockOut: clockOutMock,
  },
}));

beforeEach(() => {
  getRunningMock.mockReset();
  clockOutMock.mockReset();
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
      <ClockInCard householdId={HOUSEHOLD_ID} />
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    fireEvent.press(getByTestId('today-clock-out'));

    await waitFor(() => expect(getByTestId('clockout-confirm')).toBeTruthy());
    expect(clockOutMock).not.toHaveBeenCalled();
  });

  it('confirming immediately (fast skip) clocks out with no break and no note', async () => {
    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} />
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
      <ClockInCard householdId={HOUSEHOLD_ID} />
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
      <ClockInCard householdId={HOUSEHOLD_ID} />
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
      <ClockInCard householdId={HOUSEHOLD_ID} />
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
      <ClockInCard householdId={HOUSEHOLD_ID} />
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
});
