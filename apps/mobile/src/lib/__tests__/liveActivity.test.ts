/**
 * @module lib/__tests__/liveActivity.test
 *
 * The Live Activity lifecycle, driven through the same `expo-widgets`
 * surface the real thing uses (`factory.start` → `activity.update` /
 * `activity.end`), with only that leaf mocked.
 *
 * What is actually load-bearing here, and why each case exists:
 *  - the scheduled finish is FROZEN at start, so a mid-shift shift edit
 *    cannot rewrite the figure on her lock screen;
 *  - `overdueAtIso` is the SAME instant `ClockInCard` flips on, because the
 *    lock screen and the screen disagreeing about "still working?" is worse
 *    than neither saying anything;
 *  - a local clock-out ends with a receipt on a ~90s dismissal, a
 *    cross-device one ends immediately — and the optimistic clear that
 *    precedes a local clock-out must not be mistaken for the latter.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { TimeEntry } from '@/src/api/endpoints/timeEntries';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';

const TIME_ZONE = 'Europe/London';
const CLOCK_IN_AT = '2026-08-06T07:12:00.000Z';
const SHIFT = {
  starts_at: '2026-08-06T07:00:00.000Z',
  ends_at: '2026-08-06T16:00:00.000Z',
};
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

const updateMock = mock((_props: unknown) => Promise.resolve());
const endMock = mock((_policy?: unknown, _props?: unknown) =>
  Promise.resolve()
);
const activity = { update: updateMock, end: endMock };
const startMock = mock((_props: unknown, _url?: string) => activity);
const getInstancesMock = mock(() => [activity]);

mock.module('@/src/widgets/OnTheClock', () => ({
  OnTheClockActivity: {
    start: startMock,
    getInstances: getInstancesMock,
  },
}));

function entryFixture(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'entry-1',
    household_id: 'household-1',
    clock_in_at: CLOCK_IN_AT,
    clock_out_at: null,
    break_minutes: 0,
    timezone: TIME_ZONE,
    ...overrides,
  } as TimeEntry;
}

/** The props the factory was handed on the most recent `start`. */
function startedProps() {
  return startMock.mock.calls[startMock.mock.calls.length - 1]?.[0] as Record<
    string,
    unknown
  >;
}

function updatedProps() {
  return updateMock.mock.calls[updateMock.mock.calls.length - 1]?.[0] as Record<
    string,
    unknown
  >;
}

let liveActivity: typeof import('../liveActivity');
let resolveOverdueAtMs: typeof import('@/src/domains/today/utils/clockOutReminder').resolveOverdueAtMs;

beforeAll(async () => {
  liveActivity = await import('../liveActivity');
  ({ resolveOverdueAtMs } = await import(
    '@/src/domains/today/utils/clockOutReminder'
  ));
});

beforeEach(() => {
  // Module state is a singleton and bun runs a whole file in one process, so
  // every test starts from "no activity" rather than from the last one's.
  // `endIfStillRunning` cannot serve here: it deliberately refuses to clear a
  // receipt-phase handle, which is the whole point of the cases below.
  liveActivity.resetLiveActivityForTests();
  startMock.mockClear();
  updateMock.mockClear();
  endMock.mockClear();
  getInstancesMock.mockClear();
});

describe('startOnTheClock', () => {
  it('starts a running activity with the matched shift window and finish figure', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );

    expect(startMock).toHaveBeenCalledTimes(1);
    const props = startedProps();
    expect(props.phase).toBe('running');
    expect(props.household).toBe('Patel household');
    expect(props.scheduledStartIso).toBe(SHIFT.starts_at);
    expect(props.scheduledEndIso).toBe(SHIFT.ends_at);
    // Household zone, never the device's (GOLDEN-FIXES #21): 16:00Z is a
    // 17:00 finish in London, and the label is built from that.
    expect(props.finishLabel).toBe(
      `Scheduled finish ${formatClockTime(SHIFT.ends_at, TIME_ZONE)}`
    );
    expect(props.clockedInLabel).toBe(
      `Clocked in ${formatClockTime(CLOCK_IN_AT, TIME_ZONE)}`
    );
    expect(props.unmatchedNote).toBeNull();
  });

  it('starts without a bar or a finish when the clock-in matched no shift', async () => {
    await liveActivity.startOnTheClock(entryFixture(), null, 'Patel household');

    const props = startedProps();
    expect(props.scheduledStartIso).toBeNull();
    expect(props.scheduledEndIso).toBeNull();
    expect(props.finishLabel).toBeNull();
    expect(props.unmatchedNote).toBe('No scheduled shift today.');
  });

  it('deep-links "Clock out" into the sheet rather than clocking out in one tap (D20)', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );

    const props = startedProps();
    expect(props.clockOutUrl).toContain('clockOut=1');
    expect(props.bodyUrl).not.toContain('clockOut');
  });

  it('takes its overdue instant from the SAME rule the in-app card flips on', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );

    expect(startedProps().overdueAtIso).toBe(
      new Date(resolveOverdueAtMs(CLOCK_IN_AT, SHIFT.ends_at)).toISOString()
    );
    // ...which for a matched shift is the scheduled finish plus 30m grace.
    expect(new Date(startedProps().overdueAtIso as string).getTime()).toBe(
      new Date(SHIFT.ends_at).getTime() + THIRTY_MINUTES_MS
    );
  });

  it('falls back to the flat backstop, not the mismatched shift, when the shift ended before the clock-in', async () => {
    const staleShift = {
      starts_at: '2026-08-06T02:00:00.000Z',
      ends_at: '2026-08-06T06:00:00.000Z',
    };
    await liveActivity.startOnTheClock(
      entryFixture(),
      staleShift,
      'Patel household'
    );

    const props = startedProps();
    expect(props.scheduledEndIso).toBeNull();
    expect(props.overdueAtIso).toBe(
      new Date(resolveOverdueAtMs(CLOCK_IN_AT, null)).toISOString()
    );
  });

  it('does nothing at all for an entry with no recorded clock-in', async () => {
    await liveActivity.startOnTheClock(
      entryFixture({ clock_in_at: null }),
      SHIFT,
      'Patel household'
    );

    expect(startMock).not.toHaveBeenCalled();
  });

  it('never rejects when the platform refuses to start an activity', async () => {
    startMock.mockImplementationOnce(() => {
      throw new Error('activities are disabled');
    });

    await liveActivity.startOnTheClock(entryFixture(), SHIFT, 'Patel');
    // And the failed start leaves no phantom activity behind to update.
    await liveActivity.completeWithReceipt(
      entryFixture({ clock_out_at: '2026-08-06T16:04:00.000Z' })
    );
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('updateOnShiftMatch', () => {
  it('adds the finish and the bar when the matched shift finishes loading', async () => {
    await liveActivity.startOnTheClock(entryFixture(), null, 'Patel household');
    await liveActivity.updateOnShiftMatch(SHIFT, CLOCK_IN_AT, TIME_ZONE);

    expect(updateMock).toHaveBeenCalledTimes(1);
    const props = updatedProps();
    expect(props.scheduledEndIso).toBe(SHIFT.ends_at);
    expect(props.finishLabel).toBe(
      `Scheduled finish ${formatClockTime(SHIFT.ends_at, TIME_ZONE)}`
    );
    expect(props.household).toBe('Patel household');
  });

  it('FREEZES the finish: a later shift edit does not rewrite the lock screen', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );
    await liveActivity.updateOnShiftMatch(
      { ...SHIFT, ends_at: '2026-08-06T18:00:00.000Z' },
      CLOCK_IN_AT,
      TIME_ZONE
    );

    expect(updateMock).not.toHaveBeenCalled();
  });

  it('is inert once the activity has been ended', async () => {
    await liveActivity.startOnTheClock(entryFixture(), null, 'Patel household');
    await liveActivity.endIfStillRunning();
    await liveActivity.updateOnShiftMatch(SHIFT, CLOCK_IN_AT, TIME_ZONE);

    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('completeWithReceipt', () => {
  it('swaps to the receipt in place, then ends it ~90s later', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );
    const before = Date.now();
    await liveActivity.completeWithReceipt(
      entryFixture({
        clock_out_at: '2026-08-06T16:04:00.000Z',
        break_minutes: 30,
      })
    );

    const props = updatedProps();
    expect(props.phase).toBe('receipt');
    expect(props.title).toBe(
      `✓ Clocked out at ${formatClockTime('2026-08-06T16:04:00.000Z', TIME_ZONE)}`
    );
    expect(props.detail).toBe('8h 22m recorded · Break 30m');
    expect(props.bodyUrl).toContain('hours');

    expect(endMock).toHaveBeenCalledTimes(1);
    const policy = endMock.mock.calls[0]?.[0] as { after: Date };
    const lingerMs = policy.after.getTime() - before;
    expect(lingerMs).toBeGreaterThanOrEqual(90_000);
    expect(lingerMs).toBeLessThan(95_000);
  });

  it('omits the break clause when no break was recorded', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );
    await liveActivity.completeWithReceipt(
      entryFixture({ clock_out_at: '2026-08-06T16:04:00.000Z' })
    );

    expect(updatedProps().detail).toBe('8h 52m recorded');
  });

  it('reports the recorded row, not the schedule: a late finish shows the late total', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );
    await liveActivity.completeWithReceipt(
      entryFixture({ clock_out_at: '2026-08-06T17:12:00.000Z' })
    );

    expect(updatedProps().detail).toBe('10h recorded');
  });

  /**
   * The receipt never reached a real lock screen because of this exact
   * interleaving: `useClockOut.onSuccess` calls `completeWithReceipt` AND
   * invalidates the running-entry query, whose refetch resolves to null and
   * drives `AppBootstrap` into `endIfStillRunning` — while the 90s dismissal
   * is still pending. The receipt is legitimately live with no running entry
   * behind it; that is what it is FOR.
   */
  it('survives the clock-out refetch that immediately calls endIfStillRunning', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );
    liveActivity.beginClockOut();
    await liveActivity.completeWithReceipt(
      entryFixture({ clock_out_at: '2026-08-06T16:04:00.000Z' })
    );
    endMock.mockClear();

    await liveActivity.endIfStillRunning();

    // Not ended again, and above all not with 'immediate'.
    expect(endMock).not.toHaveBeenCalled();
    expect(getInstancesMock).not.toHaveBeenCalled();
  });

  it('leaves nothing tracked when the entry has no recorded clock-out to receipt', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );
    await liveActivity.completeWithReceipt(entryFixture());

    expect(updateMock).not.toHaveBeenCalled();
    expect(endMock).toHaveBeenCalledWith('immediate');
  });
});

describe('endIfStillRunning', () => {
  it('ends immediately when the running entry vanished without a local clock-out', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );
    await liveActivity.endIfStillRunning();

    expect(endMock).toHaveBeenCalledTimes(1);
    expect(endMock.mock.calls[0]?.[0]).toBe('immediate');
  });

  it('does NOT kill the activity during a local clock-out, whose optimistic clear looks identical', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );
    liveActivity.beginClockOut();
    await liveActivity.endIfStillRunning();

    expect(endMock).not.toHaveBeenCalled();

    // ...and the receipt still lands once the server answers.
    await liveActivity.completeWithReceipt(
      entryFixture({ clock_out_at: '2026-08-06T16:04:00.000Z' })
    );
    expect(updatedProps().phase).toBe('receipt');
  });

  it('resumes protecting the activity when the clock-out fails and the entry is still running', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );
    liveActivity.beginClockOut();
    liveActivity.abortClockOut();
    await liveActivity.endIfStillRunning();

    expect(endMock).toHaveBeenCalledTimes(1);
    expect(endMock.mock.calls[0]?.[0]).toBe('immediate');
  });

  it('after a cold start, ends whatever the system still holds', async () => {
    await liveActivity.endIfStillRunning();

    expect(getInstancesMock).toHaveBeenCalled();
    expect(endMock).toHaveBeenCalledWith('immediate');
  });
});
