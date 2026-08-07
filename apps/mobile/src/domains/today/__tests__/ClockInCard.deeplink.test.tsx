/**
 * @module domains/today/__tests__/ClockInCard.deeplink
 *
 * The Live Activity's "Clock out" button is a deep link into
 * `/home?clockOut=1`, never a one-tap clock-out — a button on the lock
 * screen that submitted immediately would recreate D20 exactly, recording
 * every unpaid break as worked time with no chance to say otherwise.
 *
 * So the link's whole job is to land on the SAME sheet the on-screen button
 * opens, with the same guards and the same forgotten-clock-out pre-fill.
 * These tests render the real card and prove three things: the param opens
 * the sheet, it is spent immediately (returning to this tab must not reopen
 * it), and it does nothing when there is nothing to clock out of.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';
import {
  mockRouter,
  setupNavigationMock,
} from '@/src/test-utils/mocks/navigation';

const HOUSEHOLD_ID = 'household-1';
// Relative to the real clock: a fixed past instant would drift into the
// forgotten-clock-out state and change what this file is testing (see
// ClockInCard.clockout.test.tsx's note).
const RECENT_CLOCK_IN = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const RUNNING_ENTRY = {
  id: 'entry-1',
  household_id: HOUSEHOLD_ID,
  clock_in_at: RECENT_CLOCK_IN,
  status: 'running',
};

const searchParams: { clockOut?: string } = {};
const getRunningMock = mock(() => Promise.resolve<unknown>(RUNNING_ENTRY));

setupNavigationMock();
mock.module('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => searchParams,
  router: mockRouter,
}));
mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: {
    getRunning: getRunningMock,
    clockIn: mock(),
    clockOut: mock(),
  },
}));
mock.module('@/src/lib/liveActivity', () => ({
  startOnTheClock: mock(() => Promise.resolve()),
  updateOnShiftMatch: mock(() => Promise.resolve()),
  completeWithReceipt: mock(() => Promise.resolve()),
  beginClockOut: mock(() => {}),
  abortClockOut: mock(() => {}),
  endIfStillRunning: mock(() => Promise.resolve()),
}));
mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

let ClockInCard: typeof import('../components/ClockInCard').ClockInCard;

beforeEach(async () => {
  searchParams.clockOut = undefined;
  getRunningMock.mockClear();
  getRunningMock.mockImplementation(() => Promise.resolve(RUNNING_ENTRY));
  mockRouter.setParams.mockClear();
  useAuthStore.setState({
    session: { user: { id: 'user-1' } } as unknown as never,
    isInitialized: true,
  } as never);
  ClockInCard = (await import('../components/ClockInCard')).ClockInCard;
});

describe('ClockInCard — arriving from the Live Activity', () => {
  it('opens the clock-out sheet when ?clockOut=1 is present', async () => {
    searchParams.clockOut = '1';

    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" />
    );

    await waitFor(() => expect(getByTestId('clockout-sheet')).toBeTruthy());
  });

  it('spends the param, so returning to this tab does not reopen the sheet', async () => {
    searchParams.clockOut = '1';

    renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" />
    );

    await waitFor(() =>
      expect(mockRouter.setParams).toHaveBeenCalledWith({ clockOut: undefined })
    );
  });

  it('opens nothing without the param — the ordinary render is untouched', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" />
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    expect(queryByTestId('clockout-sheet')).toBeNull();
  });

  it('opens nothing when she is no longer on the clock, and still spends the param', async () => {
    searchParams.clockOut = '1';
    getRunningMock.mockImplementation(() => Promise.resolve(null));

    const { getByTestId, queryByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" />
    );

    // Spent once the query ANSWERS, not once the card renders: the
    // clock-in state is what shows while the running query is still in
    // flight, so asserting on it would pass before the effect had run.
    await waitFor(() =>
      expect(mockRouter.setParams).toHaveBeenCalledWith({ clockOut: undefined })
    );
    expect(getByTestId('today-clock-in')).toBeTruthy();
    expect(queryByTestId('clockout-sheet')).toBeNull();
  });
});
