/**
 * @module lib/__tests__/useLiveActivitySync.test
 *
 * The Live Activity follows the CLOCK, not a screen. These cases exist
 * because the late shift match used to be an effect inside `ClockInCard`:
 * clock in, put the phone away, and nothing ever corrected the lock screen's
 * "No scheduled shift today." — so every case here renders the sync hook
 * ALONE, with no card mounted anywhere.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';

const HOUSEHOLD_ID = '00000000-0000-4000-8000-000000000001';
const SHIFT_ID = '00000000-0000-4000-8000-0000000000a1';
const HOUSEHOLD = {
  id: HOUSEHOLD_ID,
  name: 'Patel household',
  timezone: 'Europe/London',
};
const SHIFT = {
  id: SHIFT_ID,
  household_id: HOUSEHOLD_ID,
  starts_at: '2026-08-06T07:00:00.000Z',
  ends_at: '2026-08-06T16:00:00.000Z',
};
const RUNNING_ENTRY = {
  id: 'entry-1',
  household_id: HOUSEHOLD_ID,
  shift_id: SHIFT_ID,
  clock_in_at: '2026-08-06T07:12:00.000Z',
  clock_out_at: null,
  break_minutes: 0,
  timezone: 'Europe/London',
  status: 'running',
};

const updateOnShiftMatch = mock((..._args: unknown[]) => Promise.resolve());
const endIfStillRunning = mock(() => Promise.resolve());
const pokeOverdueRedraw = mock(() => Promise.resolve());

const MINUTE_MS = 60 * 1000;
/** `resolveOverdueAtMs` puts the threshold 30m after the scheduled finish. */
const GRACE_MS = 30 * MINUTE_MS;

/** An entry + shift whose overdue threshold lands `offsetMs` from now. */
function entryDueIn(offsetMs: number) {
  const now = Date.now();
  return {
    entry: {
      ...RUNNING_ENTRY,
      clock_in_at: new Date(now - 3 * 60 * MINUTE_MS).toISOString(),
    },
    shift: {
      ...SHIFT,
      ends_at: new Date(now + offsetMs - GRACE_MS).toISOString(),
    },
  };
}

let useLiveActivitySync: typeof import('../useLiveActivitySync').useLiveActivitySync;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeAll(async () => {
  mock.module('@/src/lib/liveActivity', () => ({
    updateOnShiftMatch,
    endIfStillRunning,
    pokeOverdueRedraw,
  }));
  // Nothing here is about fetching: every case seeds what it needs and any
  // query left unseeded must resolve to nothing rather than reach the wire.
  mock.module('@/src/api/endpoints/shifts', () => ({
    shiftApi: { getById: mock(() => Promise.resolve(null)) },
  }));
  mock.module('@/src/api/endpoints/timeEntries', () => ({
    timeEntryApi: { getRunning: mock(() => Promise.resolve(null)) },
  }));
  mock.module('@/src/api/endpoints/household', () => ({
    householdApi: { list: mock(() => Promise.resolve([])) },
  }));

  useLiveActivitySync = (await import('../useLiveActivitySync'))
    .useLiveActivitySync;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;
});

beforeEach(() => {
  updateOnShiftMatch.mockClear();
  endIfStillRunning.mockClear();
  pokeOverdueRedraw.mockClear();
  useAuthStore.setState({
    session: { user: { id: 'user-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

/** Every query seeded, so nothing here needs the network to answer. */
function seededClient(entry: unknown, shift: unknown) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(queryKeys.timeEntry.running(), entry);
  queryClient.setQueryData(queryKeys.shift.detail(SHIFT_ID), shift);
  queryClient.setQueryData(queryKeys.household.list(), [HOUSEHOLD]);
  return queryClient;
}

describe('useLiveActivitySync', () => {
  it('matches the running activity to its shift with no screen mounted', async () => {
    const queryClient = seededClient(RUNNING_ENTRY, SHIFT);

    renderHookWithProviders(() => useLiveActivitySync(), { queryClient });

    await waitFor(() => expect(updateOnShiftMatch).toHaveBeenCalledTimes(1));
    // The entry's own zone, never the device's (GOLDEN-FIXES #21), and the
    // household name for the activity this process may have to adopt.
    expect(updateOnShiftMatch).toHaveBeenCalledWith(
      SHIFT,
      RUNNING_ENTRY.clock_in_at,
      'Europe/London',
      'Patel household'
    );
  });

  it('says nothing while the matched shift has not loaded', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.timeEntry.running(), RUNNING_ENTRY);

    renderHookWithProviders(() => useLiveActivitySync(), { queryClient });

    await waitFor(() => expect(endIfStillRunning).not.toHaveBeenCalled());
    expect(updateOnShiftMatch).not.toHaveBeenCalled();
  });

  it('leaves an unmatched clock-in alone rather than inventing a window', async () => {
    const queryClient = seededClient(
      { ...RUNNING_ENTRY, shift_id: null },
      SHIFT
    );

    renderHookWithProviders(() => useLiveActivitySync(), { queryClient });

    await waitFor(() => expect(endIfStillRunning).not.toHaveBeenCalled());
    expect(updateOnShiftMatch).not.toHaveBeenCalled();
  });

  /**
   * The extension never re-runs its own overdue comparison on a schedule
   * (expo-widgets pins ActivityKit's `staleDate` to nil), so the app has to
   * poke it. Without these the card stays apricot indefinitely — measured 13
   * minutes past the threshold on device.
   */
  it('pokes the activity when the overdue instant arrives', async () => {
    const { entry, shift } = entryDueIn(60);

    renderHookWithProviders(() => useLiveActivitySync(), {
      queryClient: seededClient(entry, shift),
    });

    expect(pokeOverdueRedraw).not.toHaveBeenCalled();
    await waitFor(() => expect(pokeOverdueRedraw).toHaveBeenCalledTimes(1));
  });

  it('pokes on mount when the app was opened after the threshold passed', async () => {
    const { entry, shift } = entryDueIn(-60 * MINUTE_MS);

    const { rerender } = renderHookWithProviders(() => useLiveActivitySync(), {
      queryClient: seededClient(entry, shift),
    });

    await waitFor(() => expect(pokeOverdueRedraw).toHaveBeenCalledTimes(1));
    // Once per entry, not on every render: the instant is what re-arms it.
    rerender(undefined);
    expect(pokeOverdueRedraw).toHaveBeenCalledTimes(1);
  });

  it('does not poke while the shift is still running to schedule', async () => {
    const { entry, shift } = entryDueIn(60 * MINUTE_MS);

    renderHookWithProviders(() => useLiveActivitySync(), {
      queryClient: seededClient(entry, shift),
    });

    await waitFor(() => expect(updateOnShiftMatch).toHaveBeenCalled());
    expect(pokeOverdueRedraw).not.toHaveBeenCalled();
  });

  it('ends an activity the server says has no running entry behind it', async () => {
    const queryClient = seededClient(null, SHIFT);

    renderHookWithProviders(() => useLiveActivitySync(), { queryClient });

    await waitFor(() => expect(endIfStillRunning).toHaveBeenCalledTimes(1));
    expect(updateOnShiftMatch).not.toHaveBeenCalled();
  });
});
