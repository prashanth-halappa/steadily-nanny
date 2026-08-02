/**
 * @module domains/today/__tests__/ClockInCard.behavior.test
 *
 * D7 — the double-tap clock-in bug. Reproduced end-to-end: renders the real
 * `ClockInCard` against a real `QueryClient`, with only the API leaf
 * (`timeEntryApi`) mocked, so the actual interplay between `useClockIn`,
 * `useRunningTimeEntry`, and TanStack Query's cache is exercised — that
 * interplay is where the bug lived, not any single hook in isolation.
 * `ClockInCard.test.ts` (Pattern A, source inspection) still covers the
 * static architectural markers; this file (Pattern B) covers behavior.
 *
 * Covers, per the team-lead brief:
 *   (a) a losing double-tap's 409 never escapes as an unhandled rejection;
 *   (b) the card lands on "you're on the clock" after a 409
 *       ALREADY_CLOCKED_IN, never reverting to the "Clock in" prompt;
 *   (c) a rapid double-tap issues exactly one network call, not two.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';
import { ClockInCard } from '../components/ClockInCard';

// See loading-button.test.tsx: nativewind's mocked useColorScheme already
// resolves to 'light', so @/lib/useColorScheme's light-forcing effect is a
// no-op — but pin both explicitly anyway, matching that file's precedent,
// so this test doesn't depend on that coincidence.
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

const ALREADY_CLOCKED_IN_ERROR = {
  response: {
    status: 409,
    data: {
      error: { code: 'CONFLICT', metadata: { reason: 'ALREADY_CLOCKED_IN' } },
    },
  },
};

const getRunningMock = mock(() => Promise.resolve(null as unknown));
const clockInMock = mock(() => Promise.resolve(RUNNING_ENTRY));
const clockOutMock = mock(() =>
  Promise.resolve({ ...RUNNING_ENTRY, status: 'submitted' })
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
  clockInMock.mockImplementation(() => Promise.resolve(RUNNING_ENTRY));
  clockOutMock.mockImplementation(() =>
    Promise.resolve({ ...RUNNING_ENTRY, status: 'submitted' })
  );
  // Real Zustand store (not mocked) — same pattern as useIsOnboarded.test.ts.
  useAuthStore.setState({
    session: { user: { id: 'user-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ClockInCard — D7 double-tap', () => {
  it('a 409 ALREADY_CLOCKED_IN leaves the card on the clocked-in state, never reverting to the Clock-in prompt', async () => {
    // Models the actual race: this request loses (409), but by the time it
    // settles the server truth IS "running" — from the winning tap, or a
    // second device. getRunning must reflect that once the client refetches.
    let getRunningCalls = 0;
    getRunningMock.mockImplementation(() => {
      getRunningCalls += 1;
      return Promise.resolve(getRunningCalls === 1 ? null : RUNNING_ENTRY);
    });
    clockInMock.mockImplementationOnce(() =>
      Promise.reject(ALREADY_CLOCKED_IN_ERROR)
    );

    const { getByTestId, queryByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());

    fireEvent.press(getByTestId('today-clock-in'));

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    expect(queryByTestId('today-clock-in')).toBeNull();
  });

  it('the 409 does not escape as an unhandled promise rejection', async () => {
    getRunningMock.mockImplementation(() => Promise.resolve(null));
    clockInMock.mockImplementationOnce(() =>
      Promise.reject(ALREADY_CLOCKED_IN_ERROR)
    );

    let unhandled: unknown = null;
    const onUnhandledRejection = (reason: unknown) => {
      unhandled = reason;
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const { getByTestId } = renderWithProviders(
        <ClockInCard householdId={HOUSEHOLD_ID} />
      );
      await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());

      fireEvent.press(getByTestId('today-clock-in'));

      await waitFor(() => expect(clockInMock).toHaveBeenCalledTimes(1));
      // Flush the microtask queue so a same-tick unhandled rejection (from
      // `mutateAsync`'s re-thrown error) has a chance to surface.
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(unhandled).toBeNull();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('a rapid double-tap issues exactly one clock-in request', async () => {
    getRunningMock.mockImplementation(() => Promise.resolve(null));
    // Never resolves — isolates the assertion to "how many requests were
    // fired", independent of how fast the mock API would otherwise settle.
    clockInMock.mockImplementation(() => new Promise(() => {}));

    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} />
    );
    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());

    const button = getByTestId('today-clock-in');
    // Two presses back-to-back, before React has any chance to flush a
    // re-render (and thus before `isPending`/`disabled` could catch it) —
    // this is what a real double-tap looks like at the JS-event level.
    fireEvent.press(button);
    fireEvent.press(button);

    await waitFor(() => expect(clockInMock).toHaveBeenCalledTimes(1));
    // Give any wrongly-queued second call a chance to land, then re-check.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(clockInMock).toHaveBeenCalledTimes(1);
  });
});
