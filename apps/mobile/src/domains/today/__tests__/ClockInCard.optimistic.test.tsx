/**
 * @module domains/today/__tests__/ClockInCard.optimistic
 *
 * A1 — clock-out must not fire against an unconfirmed optimistic clock-in.
 * Renders the real card + real QueryClient; only the API leaf is mocked.
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
    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    fireEvent.press(getByTestId('today-clock-in'));

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    expect(getByTestId('today-clock-out').props.disabled).toBe(true);

    fireEvent.press(getByTestId('today-clock-out'));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(getByTestId('clockout-sheet').props.visible).toBe(false);
    expect(clockOutMock).not.toHaveBeenCalled();
  });
});
