/**
 * @module domains/today/__tests__/ClockInCard.optimistic
 *
 * A1 — clock-out must not fire against an unconfirmed optimistic clock-in.
 * Renders the real card + real QueryClient; only the API leaf is mocked.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
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

const getRunningMock = mock(() => Promise.resolve(null as unknown));
const clockInMock = mock(
  () =>
    new Promise<{ id: string; status: string }>(() => {
      /* never resolves — keeps optimistic entry unconfirmed */
    })
);
const clockOutMock = mock(() =>
  Promise.resolve({ id: 'entry-1', status: 'submitted' })
);

mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: {
    getRunning: getRunningMock,
    clockIn: clockInMock,
    clockOut: clockOutMock,
  },
}));

beforeEach(() => {
  getRunningMock.mockReset();
  clockInMock.mockReset();
  clockOutMock.mockReset();
  getRunningMock.mockImplementation(() => Promise.resolve(null));
  clockInMock.mockImplementation(
    () =>
      new Promise<{ id: string; status: string }>(() => {
        /* pending */
      })
  );
  useAuthStore.setState({
    session: { user: { id: 'user-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ClockInCard — A1 unconfirmed optimistic clock-in', () => {
  it('does not dispatch clock-out while the optimistic running entry is unconfirmed', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" weekStartsOn={1} />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    fireEvent.press(getByTestId('today-clock-in'));

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    expect(getByTestId('today-clock-out').props.disabled).toBe(true);

    fireEvent.press(getByTestId('today-clock-out'));
    await new Promise(resolve => setTimeout(resolve, 0));

    // The sheet is mounted only while open (its draft is seeded from refs
    // frozen at open time, so an always-mounted sheet would seed from a
    // null entry). "Not shown" is therefore absence, not `visible={false}`
    // — same guarantee, asserted against the current structure.
    expect(queryByTestId('clockout-sheet')).toBeNull();
    expect(clockOutMock).not.toHaveBeenCalled();
  });

  // F-B8-6: the card already knows the household's zone (it renders every
  // clock time in it) — the unconfirmed row must be filed under that zone's
  // day too, not the travelling carer's device day.
  it('files the unconfirmed row under the household zone the card renders in', async () => {
    const { getByTestId, queryClient } = renderWithProviders(
      <ClockInCard
        householdId={HOUSEHOLD_ID}
        timeZone="Pacific/Auckland"
        weekStartsOn={1}
      />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    fireEvent.press(getByTestId('today-clock-in'));

    await waitFor(() => {
      expect(
        queryClient.getQueryData(queryKeys.timeEntry.running())
      ).toMatchObject({ timezone: 'Pacific/Auckland' });
    });
  });
});
