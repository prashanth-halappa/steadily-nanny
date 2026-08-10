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
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';
import type { TimeEntry } from '@/src/api/endpoints/timeEntries';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';

const TIME_ZONE = 'Europe/London';
const RECEIPT_LINGER_MS = 90 * 1000;
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
/** A previous entry's receipt, still dismissing — never the one to adopt. */
const staleUpdateMock = mock((_props: unknown) => Promise.resolve());
const staleEndMock = mock((_policy?: unknown, _props?: unknown) =>
  Promise.resolve()
);
const staleActivity = { update: staleUpdateMock, end: staleEndMock };
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
  //
  // Resetting it is ALSO how a process restart is simulated: the module
  // forgets, the system (`getInstances`) does not.
  liveActivity.resetLiveActivityForTests();
  startMock.mockClear();
  updateMock.mockClear();
  endMock.mockClear();
  getInstancesMock.mockClear();
  getInstancesMock.mockImplementation(() => [activity]);
  staleUpdateMock.mockClear();
  staleEndMock.mockClear();
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
    // The Dynamic Island's scalar: the SAME household-zone time, unwrapped.
    expect(props.finishTimeShort).toBe(
      formatClockTime(SHIFT.ends_at, TIME_ZONE)
    );
    expect(props.clockedInLabel).toBe(
      `Clocked in ${formatClockTime(CLOCK_IN_AT, TIME_ZONE)}`
    );
    expect(props.unmatchedNote).toBeNull();
  });

  // The island used to render `Text(date:style:.time)`, which SwiftUI formats
  // in the DEVICE's zone — it read `2:26 PM` beside a banner saying
  // `Scheduled finish 10:26 PM`. Containment is the invariant that broke: the
  // island's time must be the one already inside the banner's sentence.
  it('gives the Dynamic Island the same time the banner shows, never a second one', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );

    const props = startedProps();
    expect(props.finishTimeShort).toBeTruthy();
    expect(props.finishLabel).toContain(props.finishTimeShort);
  });

  it('starts without a bar or a finish when the clock-in matched no shift', async () => {
    await liveActivity.startOnTheClock(entryFixture(), null, 'Patel household');

    const props = startedProps();
    expect(props.scheduledStartIso).toBeNull();
    expect(props.scheduledEndIso).toBeNull();
    expect(props.finishLabel).toBeNull();
    expect(props.finishTimeShort).toBeNull();
    // Deliberately null, not a sentence. This fires on the lock screen of a
    // carer who IS on the clock; "No scheduled shift today." read as a
    // correction — you shouldn't be working — while she was working.
    expect(props.unmatchedNote).toBeNull();
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
    // A start that threw created nothing, so the system holds nothing for
    // the receipt to adopt either.
    getInstancesMock.mockImplementation(() => []);
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
    // The adoption path rebuilds the props, so the island's scalar has to
    // arrive with them — an adopted activity must not be left blank.
    expect(props.finishTimeShort).toBe(
      formatClockTime(SHIFT.ends_at, TIME_ZONE)
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
    // An ended activity is not among the system's instances any more, so
    // there is nothing left for the adoption fallback below to find either.
    getInstancesMock.mockImplementation(() => []);
    await liveActivity.updateOnShiftMatch(SHIFT, CLOCK_IN_AT, TIME_ZONE);

    expect(updateMock).not.toHaveBeenCalled();
  });

  /**
   * Losing the module state to a process restart used to be permanent: the
   * activity stayed up saying "No scheduled shift today." for the rest of a
   * matched shift, because nothing could reach it any more.
   */
  it('adopts the activity the system still holds when the process restarted', async () => {
    await liveActivity.updateOnShiftMatch(
      SHIFT,
      CLOCK_IN_AT,
      TIME_ZONE,
      'Patel household'
    );

    expect(getInstancesMock).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledTimes(1);
    const props = updatedProps();
    expect(props.phase).toBe('running');
    expect(props.scheduledEndIso).toBe(SHIFT.ends_at);
    expect(props.finishLabel).toBe(
      `Scheduled finish ${formatClockTime(SHIFT.ends_at, TIME_ZONE)}`
    );
    // The household name cannot be recovered from the adopted instance, so
    // the caller supplies it — the banner must still name the family.
    expect(props.household).toBe('Patel household');
  });

  it('tracks what it adopted, so the finish is frozen from then on', async () => {
    await liveActivity.updateOnShiftMatch(SHIFT, CLOCK_IN_AT, TIME_ZONE);
    updateMock.mockClear();

    await liveActivity.updateOnShiftMatch(
      { ...SHIFT, ends_at: '2026-08-06T18:00:00.000Z' },
      CLOCK_IN_AT,
      TIME_ZONE
    );

    expect(updateMock).not.toHaveBeenCalled();
  });

  it('has nothing to adopt when the system holds no activity', async () => {
    getInstancesMock.mockImplementation(() => []);

    await liveActivity.updateOnShiftMatch(SHIFT, CLOCK_IN_AT, TIME_ZONE);

    expect(updateMock).not.toHaveBeenCalled();
  });

  it('never adopts an activity for a shift that had already ended', async () => {
    await liveActivity.updateOnShiftMatch(
      {
        starts_at: '2026-08-06T02:00:00.000Z',
        ends_at: '2026-08-06T06:00:00.000Z',
      },
      CLOCK_IN_AT,
      TIME_ZONE
    );

    expect(getInstancesMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});

/**
 * The extension re-evaluates its own `Date.now() >= overdueAtIso` only when
 * something calls `update()` — `expo-widgets` pins ActivityKit's `staleDate`
 * to nil — so this update, with nothing changed, IS the overdue flip.
 */
describe('pokeOverdueRedraw', () => {
  it('re-pushes the current props so the body re-runs', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );
    await liveActivity.pokeOverdueRedraw();

    expect(updateMock).toHaveBeenCalledTimes(1);
    // Unchanged: the redraw is the point, not a new figure.
    expect(updatedProps()).toEqual(startedProps());
  });

  it('does nothing with no activity to poke', async () => {
    await liveActivity.pokeOverdueRedraw();

    expect(updateMock).not.toHaveBeenCalled();
    // And never adopts — a poke has no props of its own to push.
    expect(getInstancesMock).not.toHaveBeenCalled();
  });

  it('leaves a receipt alone — it has no overdue state to reach', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );
    await liveActivity.completeWithReceipt(
      entryFixture({ clock_out_at: '2026-08-06T16:04:00.000Z' })
    );
    updateMock.mockClear();

    await liveActivity.pokeOverdueRedraw();

    expect(updateMock).not.toHaveBeenCalled();
  });

  it('leaves a clock-out in flight alone', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );
    liveActivity.beginClockOut();

    await liveActivity.pokeOverdueRedraw();

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
   * drives `useLiveActivitySync` into `endIfStillRunning` — while the 90s
   * dismissal is still pending. The receipt is legitimately live with no
   * running entry behind it; that is what it is FOR.
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

  /**
   * The second missing-receipt failure, traced on device: kill the app
   * mid-shift and clock out after relaunch, and `current` is null, so
   * `beginClockOut` no-ops, `endIfStillRunning` has no phase to defer to and
   * sweeps her still-live activity away, and `completeWithReceipt` returns at
   * its own null check. Activity gone, no receipt, nothing logged. The
   * protection cannot live on `current` alone — that dies with the process.
   */
  it('still lands the receipt when the clock-out follows a process restart', async () => {
    liveActivity.resetLiveActivityForTests(); // the restart
    liveActivity.beginClockOut();
    await liveActivity.endIfStillRunning(); // the optimistic clear

    expect(endMock).not.toHaveBeenCalled();

    await liveActivity.completeWithReceipt(
      entryFixture({ clock_out_at: '2026-08-06T16:04:00.000Z' })
    );

    expect(updatedProps().phase).toBe('receipt');
    expect(updatedProps().detail).toBe('8h 52m recorded');
  });

  /**
   * B2 on device: her previous clock-out's receipt was still dismissing when
   * she clocked in again, so two activities coexisted. After a restart the
   * receipt adopted `getInstances()[0]` — the DYING one — and updated a
   * corpse while her real activity sat frozen in its pre-clock-out state.
   */
  it('adopts the live activity, not a previous entry still dismissing', async () => {
    getInstancesMock.mockImplementation(() => [staleActivity, activity]);
    liveActivity.resetLiveActivityForTests(); // the restart
    liveActivity.beginClockOut();

    await liveActivity.completeWithReceipt(
      entryFixture({ clock_out_at: '2026-08-06T16:04:00.000Z' })
    );

    expect(staleUpdateMock).not.toHaveBeenCalled();
    expect(updatedProps().phase).toBe('receipt');
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

  /**
   * The flaky missing receipt. At app start `useLiveActivitySync` fires this
   * for the orphan sweep, and it nulls `current` and then AWAITS the lazy
   * `getFactory()` import. A clock-in landing inside that await starts a
   * brand-new activity which `getInstances()` then hands to the sweep, which
   * ends it 'immediate' — silently, since nothing throws. She is on the
   * clock with no Live Activity, and at clock-out there is nothing left to
   * turn into a receipt. Slow enough to never reproduce by hand; an
   * automated clock-in right after launch hits it repeatedly.
   */
  it('does not sweep away an activity a clock-in started during its own await', async () => {
    const sweep = liveActivity.endIfStillRunning(); // in flight, not awaited
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );
    await sweep;

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(endMock).not.toHaveBeenCalled();
  });

  it('after a cold start, ends whatever the system still holds', async () => {
    await liveActivity.endIfStillRunning();

    expect(getInstancesMock).toHaveBeenCalled();
    expect(endMock).toHaveBeenCalledWith('immediate');
  });

  /**
   * The receipt's release used to be a `setTimeout`, which the process death
   * that follows a backgrounded clock-out simply eats. The handle then sat
   * in `'receipt'` phase forever and this guard returned early every time —
   * so the NEXT shift's cross-device clock-out could never end its activity.
   */
  it('clears a receipt that has outlived its own dismissal', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );
    await liveActivity.completeWithReceipt(
      entryFixture({ clock_out_at: '2026-08-06T16:04:00.000Z' })
    );
    endMock.mockClear();

    const afterLinger = Date.now() + RECEIPT_LINGER_MS + 1000;
    const nowSpy = spyOn(Date, 'now').mockReturnValue(afterLinger);
    try {
      await liveActivity.endIfStillRunning();
    } finally {
      nowSpy.mockRestore();
    }

    expect(endMock).toHaveBeenCalledWith('immediate');
  });

  it('still protects a receipt that is mid-linger', async () => {
    await liveActivity.startOnTheClock(
      entryFixture(),
      SHIFT,
      'Patel household'
    );
    await liveActivity.completeWithReceipt(
      entryFixture({ clock_out_at: '2026-08-06T16:04:00.000Z' })
    );
    endMock.mockClear();

    await liveActivity.endIfStillRunning();

    expect(endMock).not.toHaveBeenCalled();
  });
});
