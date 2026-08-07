/**
 * @module hooks/mutations/__tests__/clockMutations.liveActivity.test
 *
 * The Live Activity is wired into the clock-in/clock-out MUTATIONS rather
 * than into `ClockInCard`, so it follows the clock rather than the screen:
 * any future call site gets the lock-screen state for free, and a clock-out
 * from the sheet, from a retry, or from anywhere else can't leave a stale
 * activity behind.
 *
 * The ordering here is the part that actually bites. `useClockOut.onMutate`
 * clears the running-entry cache optimistically, which is indistinguishable
 * from a cross-device clock-out — so it must announce itself (`beginClockOut`)
 * BEFORE the AppBootstrap orphan check can see the null and kill the
 * activity a beat before the receipt replaces it.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { onlineManager } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';

const HOUSEHOLD_ID = '00000000-0000-4000-8000-000000000001';
const SHIFT_ID = '00000000-0000-4000-8000-0000000000a1';
const SHIFT = {
  id: SHIFT_ID,
  household_id: HOUSEHOLD_ID,
  starts_at: '2026-08-06T07:00:00.000Z',
  ends_at: '2026-08-06T16:00:00.000Z',
};
const RUNNING_ENTRY = {
  id: 'entry-1',
  household_id: HOUSEHOLD_ID,
  shift_id: null,
  clock_in_at: '2026-08-06T07:12:00.000Z',
  clock_out_at: null,
  break_minutes: 0,
  timezone: 'Europe/London',
  status: 'running',
};
const MATCHED_ENTRY = { ...RUNNING_ENTRY, shift_id: SHIFT_ID };
const FINISHED_ENTRY = {
  ...RUNNING_ENTRY,
  clock_out_at: '2026-08-06T16:04:00.000Z',
  break_minutes: 30,
  status: 'submitted',
};

const clockInMock = mock(() => Promise.resolve<unknown>(RUNNING_ENTRY));
const clockOutMock = mock(() => Promise.resolve<unknown>(FINISHED_ENTRY));
const startOnTheClock = mock((..._args: unknown[]) => Promise.resolve());
const completeWithReceipt = mock((..._args: unknown[]) => Promise.resolve());
const beginClockOut = mock(() => {});
const abortClockOut = mock(() => {});

mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: { clockIn: clockInMock, clockOut: clockOutMock },
}));
mock.module('@/src/lib/toast', () => ({ showErrorToast: mock(() => {}) }));
mock.module('@/src/lib/network', () => ({
  useIsOnline: mock(() => true),
  setupNetworkManagers: mock(),
}));
mock.module('@/src/lib/liveActivity', () => ({
  startOnTheClock,
  completeWithReceipt,
  beginClockOut,
  abortClockOut,
  updateOnShiftMatch: mock(() => Promise.resolve()),
  endIfStillRunning: mock(() => Promise.resolve()),
}));

let useClockIn: typeof import('../useClockIn').useClockIn;
let useClockOut: typeof import('../useClockOut').useClockOut;

beforeEach(async () => {
  clockInMock.mockClear();
  clockOutMock.mockClear();
  clockInMock.mockImplementation(() => Promise.resolve(RUNNING_ENTRY));
  clockOutMock.mockImplementation(() => Promise.resolve(FINISHED_ENTRY));
  startOnTheClock.mockClear();
  completeWithReceipt.mockClear();
  beginClockOut.mockClear();
  abortClockOut.mockClear();
  onlineManager.setOnline(true);
  useClockIn = (await import('../useClockIn')).useClockIn;
  useClockOut = (await import('../useClockOut')).useClockOut;
});

describe('useClockIn', () => {
  it('starts the Live Activity from the SERVER entry, naming the household', async () => {
    const { result } = renderHookWithProviders(() =>
      useClockIn('Europe/London', 'Patel household')
    );

    await act(async () => {
      await result.current.mutateAsync({ household_id: HOUSEHOLD_ID });
    });

    await waitFor(() => expect(startOnTheClock).toHaveBeenCalledTimes(1));
    // Never the optimistic row: it has a fabricated id and no server-resolved
    // shift match. No window here because this clock-in matched no shift.
    expect(startOnTheClock).toHaveBeenCalledWith(
      RUNNING_ENTRY,
      null,
      'Patel household'
    );
  });

  /**
   * The clock-in response carries only a `shift_id`, so the activity used to
   * start unmatched ALWAYS — "No scheduled shift today." on the lock screen
   * of a nanny who had one, until a screen that happened to be mounted
   * corrected it. The shift is already cached by whoever clocked her in, so
   * the matched window costs a cache read rather than a request.
   */
  it('starts already matched when the shift the server matched is in the cache', async () => {
    clockInMock.mockImplementation(() => Promise.resolve(MATCHED_ENTRY));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      queryKeys.shift.range(HOUSEHOLD_ID, 'from', 'to'),
      [SHIFT]
    );

    const { result } = renderHookWithProviders(
      () => useClockIn('Europe/London', 'Patel household'),
      { queryClient }
    );
    await act(async () => {
      await result.current.mutateAsync({ household_id: HOUSEHOLD_ID });
    });

    await waitFor(() => expect(startOnTheClock).toHaveBeenCalledTimes(1));
    expect(startOnTheClock).toHaveBeenCalledWith(
      MATCHED_ENTRY,
      SHIFT,
      'Patel household'
    );
  });

  it("also finds it among the carer's own cross-household shifts", async () => {
    clockInMock.mockImplementation(() => Promise.resolve(MATCHED_ENTRY));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.me.shifts('from', 'to'), [SHIFT]);

    const { result } = renderHookWithProviders(() => useClockIn(), {
      queryClient,
    });
    await act(async () => {
      await result.current.mutateAsync({ household_id: HOUSEHOLD_ID });
    });

    await waitFor(() => expect(startOnTheClock).toHaveBeenCalledTimes(1));
    expect(startOnTheClock).toHaveBeenCalledWith(MATCHED_ENTRY, SHIFT, '');
  });

  it('starts unmatched when the matched shift is nowhere in the cache', async () => {
    clockInMock.mockImplementation(() => Promise.resolve(MATCHED_ENTRY));
    const { result } = renderHookWithProviders(() => useClockIn());

    await act(async () => {
      await result.current.mutateAsync({ household_id: HOUSEHOLD_ID });
    });

    // Not a failure: `useLiveActivitySync` fills the window in once the
    // shift query resolves.
    await waitFor(() => expect(startOnTheClock).toHaveBeenCalledTimes(1));
    expect(startOnTheClock).toHaveBeenCalledWith(MATCHED_ENTRY, null, '');
  });

  it('does not start one when the clock-in failed', async () => {
    clockInMock.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const { result } = renderHookWithProviders(() => useClockIn());

    await act(async () => {
      await expect(
        result.current.mutateAsync({ household_id: HOUSEHOLD_ID })
      ).rejects.toThrow('boom');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(startOnTheClock).not.toHaveBeenCalled();
  });
});

describe('useClockOut', () => {
  it('claims the activity before the optimistic clear, then hands it the recorded row', async () => {
    const { result } = renderHookWithProviders(() => useClockOut());

    await act(async () => {
      await result.current.mutateAsync({ entryId: 'entry-1' });
    });

    await waitFor(() => expect(completeWithReceipt).toHaveBeenCalledTimes(1));
    expect(beginClockOut).toHaveBeenCalledTimes(1);
    // The receipt's figures come off the clocked-out entry the server
    // returned, never off a client-side guess at break or finish.
    expect(completeWithReceipt).toHaveBeenCalledWith(FINISHED_ENTRY);
    expect(abortClockOut).not.toHaveBeenCalled();
  });

  it('releases the activity when the clock-out fails — she is still on the clock', async () => {
    clockOutMock.mockImplementationOnce(() =>
      Promise.reject(new Error('boom'))
    );
    const { result } = renderHookWithProviders(() => useClockOut());

    await act(async () => {
      await expect(
        result.current.mutateAsync({ entryId: 'entry-1' })
      ).rejects.toThrow('boom');
    });

    await waitFor(() => expect(abortClockOut).toHaveBeenCalledTimes(1));
    expect(completeWithReceipt).not.toHaveBeenCalled();
  });
});
