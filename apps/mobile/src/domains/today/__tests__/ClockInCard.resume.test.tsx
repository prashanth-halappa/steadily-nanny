/**
 * @module domains/today/__tests__/ClockInCard.resume
 *
 * D17 — after a normal clock-in then clock-out, simply backgrounding and
 * foregrounding the app left the Today card stuck showing "you're on the
 * clock" with a live-ticking timer, indefinitely; only a full kill-and-
 * relaunch fixed it. Root cause: nothing ever revalidated the running-entry
 * query on resume. The Tabs navigator keeps `TodayScreen` mounted across a
 * background/foreground cycle, so `refetchOnMount` never fires, and the
 * app's global `refetchOnWindowFocus: false` killed the one mechanism that
 * would have — `setupNetworkManagers`'s AppState → focusManager bridge
 * (`src/lib/network.ts`), already wired at app start in `_layout.tsx`, whose
 * own header comment says its purpose is "enabling refetch-on-focus".
 *
 * Fix: flip that global default (see `queryClient.ts`) so the existing
 * wiring actually does what it was built for. Chosen globally rather than as
 * a per-query override, because the same staleness bug applies to every
 * query in the app, not just this one — see `queryClient.ts` for the full
 * reasoning. A focus refetch still only fires for a query whose own
 * `staleTime` has elapsed, which the second test below exercises: no request
 * storm from a resume that finds nothing stale.
 *
 * Renders `ClockInCard` against the app's REAL `queryClient` singleton (not
 * a fresh per-test client) so this is a genuine regression test: a fresh
 * `createTestQueryClient()` never overrides `refetchOnWindowFocus`, so it
 * already defaults to TanStack's own `true` and would pass either way.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { focusManager } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { queryClient } from '@/src/api/queryClient';
import { queryKeys } from '@/src/api/queryKeys';
import { useAuthStore } from '@/src/store/auth';
import type { MockFn } from '@/src/test-utils';
import { renderWithProviders } from '@/src/test-utils';
import { ClockInCard } from '../components/ClockInCard';

// See ClockInCard.behavior.test.tsx: pin these explicitly rather than rely
// on the preload's coincidental defaults.
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

mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: {
    getRunning: getRunningMock,
    clockIn: mock(),
    clockOut: mock(),
  },
}));

// Mirrors the AppState → focusManager wiring in `src/lib/network.ts`'s
// `setupNetworkManagers` — which is what `_layout.tsx` calls once at app
// start, and is not itself part of this fix (it's pre-existing, correct,
// and outside this file's ownership). Reproduced inline rather than
// imported because that module also wires `onlineManager` to the real
// NetInfo native module, which isn't available in this test environment and
// isn't relevant to the fix under test here (`queryClient.ts`'s
// `refetchOnWindowFocus`).
focusManager.setEventListener(setFocused => {
  const subscription = AppState.addEventListener('change', status => {
    setFocused(status === 'active');
  });
  return () => subscription.remove();
});

/** Simulates the OS bringing the app to the foreground. */
function resumeApp() {
  const addEventListener = AppState.addEventListener as MockFn<
    (type: string, cb: (state: string) => void) => { remove: () => void }
  >;
  const call = addEventListener.mock.calls.at(-1);
  if (!call)
    throw new Error(
      'setupNetworkManagers never registered an AppState listener'
    );
  const [, listener] = call;
  listener('active');
}

beforeEach(() => {
  getRunningMock.mockReset();
  getRunningMock.mockImplementation(() => Promise.resolve(RUNNING_ENTRY));
  queryClient.clear();
  useAuthStore.setState({
    session: { user: { id: 'user-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

afterEach(() => {
  queryClient.clear();
});

describe('ClockInCard — D17 stale clock state on app resume', () => {
  it('an AppState resume refetches a stale running-entry query and clears the ticking timer once the server says clocked out', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} />,
      { queryClient }
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    expect(getByTestId('today-live-timer')).toBeTruthy();

    // Server truth changed while backgrounded (clocked out elsewhere, or a
    // clock-out on this device that a real reload would otherwise be needed
    // to see) — mark the cached entry stale past the hook's 30s staleTime
    // without waiting 30 real seconds, then flip the mocked response.
    queryClient.setQueryData(queryKeys.timeEntry.running(), RUNNING_ENTRY, {
      updatedAt: Date.now() - 40_000,
    });
    getRunningMock.mockImplementation(() => Promise.resolve(null));

    resumeApp();

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());
    expect(queryByTestId('today-clock-out')).toBeNull();
    expect(queryByTestId('today-live-timer')).toBeNull();
    expect(getRunningMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('an AppState resume does not refetch a running-entry query that is still fresh (no request storm)', async () => {
    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} />,
      { queryClient }
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    const callsAfterMount = getRunningMock.mock.calls.length;

    resumeApp();
    // Give a wrongly-fired refetch a chance to land before asserting it didn't.
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(getRunningMock.mock.calls.length).toBe(callsAfterMount);
  });
});
