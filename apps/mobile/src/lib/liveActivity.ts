/**
 * @module lib/liveActivity
 *
 * Lifecycle for the nanny's "on the clock" Live Activity. The LA is driven
 * entirely on-device — no push channel, no LA push tokens — so this module
 * is the only thing that ever starts, updates or ends it.
 *
 * Three rules shape the API:
 *
 * 1. **Props carry finished strings, never data.** The extension runs the
 *    layout in a bare JavaScriptCore context with no i18n, no Intl locale
 *    data and no household timezone, so every label is localized and
 *    zone-formatted HERE, at start/update time, and shipped as plain text.
 *
 * 2. **The scheduled finish is FROZEN at start.** It is the finish that was
 *    agreed when she clocked in. A parent editing the shift at 14:00 must
 *    not silently rewrite the figure on her lock screen; the app can argue
 *    about the new plan, the lock screen states what was agreed.
 *
 * 3. **It must never be able to break a clock-in.** Every entry point is
 *    fire-and-forget and swallows its own failures: Live Activities can be
 *    disabled system-wide, refused per-app, or unavailable below iOS 16.2,
 *    and none of that is a reason for `useClockIn` to report an error.
 *
 * The overdue threshold is NOT computed here — it comes from
 * `domains/today/utils/clockOutReminder`, the same rule that flips
 * `ClockInCard` and arms the local reminder, so the lock screen and the
 * screen can never disagree about when a shift stopped being plausible.
 *
 * Note on the overdue state: an activity can never START overdue.
 * `usableWindow` drops a window whose `ends_at` is at or before the
 * clock-in, and `resolveOverdueAtMs` adds a grace period on top of the
 * finish it keeps — so `overdueAtIso` is always in the future at start, by
 * construction, and the overdue layout is only ever reached by the
 * extension's own clock crossing it. There is nothing to test for
 * "starts overdue", and nothing to fix: the guard is the reason.
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import * as Linking from 'expo-linking';
import type { LiveActivity } from 'expo-widgets';
import { Platform } from 'react-native';
import type { TimeEntry } from '@/src/api/endpoints/timeEntries';
import {
  formatClockTime,
  formatDuration,
} from '@/src/domains/timesheet/utils/duration';
import { computeWorkedMinutesFromInstants } from '@/src/domains/timesheet/utils/entryMinutes';
import { resolveOverdueAtMs } from '@/src/domains/today/utils/clockOutReminder';
import i18n from '@/src/i18n';
import { reportWidgetFailure } from '@/src/lib/expoWidgets';
import { widgetArtUri } from '@/src/lib/widgetArt';
import type {
  OnTheClockProps,
  OnTheClockRunningProps,
} from '@/src/widgets/OnTheClock';

/** The scheduled window, all this module ever needs off a shift. */
type ScheduledWindow = Pick<Shift, 'starts_at' | 'ends_at'>;

/**
 * How long the receipt stays on the lock screen after clock-out. Long
 * enough to read and tap through to Hours, short enough that it is gone
 * before it becomes clutter.
 */
const RECEIPT_LINGER_MS = 90 * 1000;

/**
 * `'clockingOut'` exists so the optimistic clear in `useClockOut.onMutate`
 * — which momentarily makes the running-entry cache look exactly like a
 * cross-device clock-out — cannot make `endIfStillRunning` kill the
 * activity a beat before the receipt replaces it.
 */
type Phase = 'running' | 'clockingOut' | 'receipt';

let current: {
  activity: LiveActivity<OnTheClockProps>;
  props: OnTheClockRunningProps;
  phase: Phase;
  /**
   * When the receipt's own dismissal is due. Set only in `'receipt'` phase:
   * past it the handle is spent, and `endIfStillRunning` may clear it. A
   * timer alone cannot do that job — it dies with the process, and a
   * receipt handle that outlives its timer used to block every later
   * clock-out from ever ending its activity.
   */
  receiptEndsAtMs?: number;
} | null = null;

/**
 * Bumped synchronously by every `startOnTheClock`, so an async orphan sweep
 * can tell whether a clock-in happened while it was suspended. `current`
 * alone cannot: the sweep nulls it on entry, and a start that is still
 * awaiting its own factory has not set it again yet.
 */
let startGeneration = 0;

/**
 * A local clock-out is in flight. Deliberately NOT on `current`: after a
 * process restart mid-shift nothing is tracked, so `beginClockOut` had
 * nothing to mark, `endIfStillRunning` had no phase to defer to and swept
 * her still-live activity away, and the receipt never happened. Module
 * state dies with the process too, but this only has to outlive one
 * clock-out, not a restart.
 */
let clockOutInFlight = false;

/**
 * Test-only: forget the tracked activity. `endIfStillRunning` deliberately
 * will NOT clear a `'receipt'`-phase handle, so it cannot serve as a reset.
 */
export function resetLiveActivityForTests(): void {
  current = null;
  clockOutInFlight = false;
}

/**
 * Imported lazily and only on iOS: constructing the factory registers the
 * serialized layout with the native module, which must not happen at app
 * start on Android, nor under `bun:test` where the native module is absent.
 */
async function getFactory() {
  if (Platform.OS !== 'ios') return null;
  try {
    const { OnTheClockActivity } = await import('@/src/widgets/OnTheClock');
    return OnTheClockActivity;
  } catch (error) {
    reportWidgetFailure('la:factory', error);
    return null;
  }
}

async function startActivity(props: OnTheClockProps, url: string) {
  const factory = await getFactory();
  return factory ? factory.start(props, url) : null;
}

/**
 * The shift's finish, or null when it cannot be the finish of THIS entry.
 * A finish at or before the clock-in means the 2h auto-match attached a
 * shift that had already ended — same exclusion `resolveOverdueAtMs` makes,
 * and for the same reason: showing it would put the bar and the "scheduled
 * finish" figure in the past the moment the activity appeared.
 */
function usableWindow(
  clockInAt: string,
  shift: ScheduledWindow | null
): ScheduledWindow | null {
  if (!shift) return null;
  const endMs = new Date(shift.ends_at).getTime();
  const clockInMs = new Date(clockInAt).getTime();
  if (!Number.isFinite(endMs) || endMs <= clockInMs) return null;
  return shift;
}

function buildRunningProps(
  clockInAt: string,
  timeZone: string,
  householdName: string,
  shift: ScheduledWindow | null
): OnTheClockRunningProps {
  const window = usableWindow(clockInAt, shift);
  const finishTime = window ? formatClockTime(window.ends_at, timeZone) : null;

  return {
    phase: 'running',
    title: i18n.t('today:liveActivity.onTheClock'),
    household: householdName,
    clockedInLabel: i18n.t('today:liveActivity.clockedInAt', {
      time: formatClockTime(clockInAt, timeZone),
    }),
    finishLabel: finishTime
      ? i18n.t('today:liveActivity.scheduledFinish', { time: finishTime })
      : null,
    // The same household-zone time `finishLabel` embeds, unwrapped for the
    // Dynamic Island. Not new copy — the identical value, without the
    // sentence around it.
    finishTimeShort: finishTime,
    // No note when nothing matched. It used to read "No scheduled shift
    // today." on the lock screen of a carer who was ON THE CLOCK — a bare
    // negation implying she shouldn't be working. Absence of a shift is not
    // something she needs told while she is standing in the house working.
    unmatchedNote: null,
    // With no scheduled finish there is no time to be "past", so the
    // overdue headline falls back to the card's own flat-backstop wording.
    overdueTitle: finishTime
      ? i18n.t('today:liveActivity.overdueTitle', { time: finishTime })
      : i18n.t('today:stillOnTheClockTitle'),
    overdueNote: i18n.t('today:liveActivity.overdueBody'),
    overdueAtIso: new Date(
      resolveOverdueAtMs(clockInAt, window?.ends_at ?? null)
    ).toISOString(),
    scheduledStartIso: window?.starts_at ?? null,
    scheduledEndIso: window?.ends_at ?? null,
    clockOutLabel: i18n.t('today:liveActivity.clockOut'),
    clockOutUrl: Linking.createURL('/home?clockOut=1'),
    bodyUrl: Linking.createURL('/home'),
    // Dark only — a Live Activity gets no `colorScheme`. The body drops the
    // image itself on the overdue card, where art would undercut the amber.
    artUri: widgetArtUri('la-running-dark'),
  };
}

/**
 * Start the activity for a freshly created running entry. `shift` is the
 * window the clock-in matched, which `useClockIn` resolves out of the query
 * cache: the response itself carries only a `shift_id`. `null` is the
 * honest answer for an unmatched clock-in AND for a shift nothing had
 * cached — `updateOnShiftMatch` fills the latter in a moment later.
 */
export async function startOnTheClock(
  entry: TimeEntry,
  shift: ScheduledWindow | null,
  householdName: string
): Promise<void> {
  if (!entry.clock_in_at) return;
  // Before the first await: an in-flight sweep must see this immediately.
  startGeneration += 1;
  try {
    const props = buildRunningProps(
      entry.clock_in_at,
      entry.timezone,
      householdName,
      shift
    );
    const activity = await startActivity(props, props.bodyUrl);
    if (!activity) {
      // Not iOS, or the layout module would not load. Silent until now, which
      // made "the LA simply never appears" indistinguishable from a throw.
      reportWidgetFailure('la:start', new Error('no Live Activity factory'));
      return;
    }
    current = { activity, props, phase: 'running' };
  } catch (error) {
    // Activities disabled, refused, or unsupported — not a clock-in failure.
    // Still swallowed, never silent: the LA vanishing without a trace cost a
    // full validation round to notice.
    reportWidgetFailure('la:start', error);
    current = null;
  }
}

/**
 * The activity this process did not start: after a restart the module state
 * is gone but the system still holds the running activity, so it is adopted
 * from the factory rather than left orphaned.
 */
async function adoptLiveInstance(): Promise<LiveActivity<OnTheClockProps> | null> {
  const factory = await getFactory();
  // NEWEST, not first. Her previous clock-out's receipt lingers ~90s, so
  // clocking in again inside that window leaves two activities coexisting;
  // adopting `[0]` updated the DYING one while her real activity sat frozen
  // in its pre-clock-out state.
  //
  // ponytail: relies on `getInstances()` being creation-ordered, which
  // ActivityKit does not document. If that ever proves false, persist the
  // started activity's id (App Group, next to the widget art) and adopt by
  // id — more machinery, so not until it earns it.
  const instances = factory?.getInstances() ?? [];
  return instances[instances.length - 1] ?? null;
}

/**
 * The shift the clock-in matched has finished loading: add the scheduled
 * finish and the progress bar. Ignored once anything else has happened to
 * the activity, and ignored when the figures would not change — this is
 * driven by a query subscription and must not update on every refetch.
 *
 * With no tracked handle this ADOPTS whatever the system still holds, so a
 * process restart mid-shift no longer strands the activity as permanently
 * unmatched — the same fallback `endIfStillRunning` makes, and with the same
 * blind spot: an adopted instance could in principle be a receipt left over
 * from before the restart. It cannot be one here, because the caller only
 * gets this far while a running entry exists, and a receipt means she is
 * clocked out.
 *
 * `householdName` is only read on that adoption path — a tracked handle
 * already carries the name it started with, which is the one that was true.
 */
export async function updateOnShiftMatch(
  shift: ScheduledWindow,
  clockInAt: string,
  timeZone: string,
  householdName = ''
): Promise<void> {
  if (current && current.phase !== 'running') return;
  if (current?.props.scheduledEndIso) return; // frozen — see module header
  try {
    const props = buildRunningProps(
      clockInAt,
      timeZone,
      current?.props.household ?? householdName,
      shift
    );
    if (!props.scheduledEndIso) return;
    const activity = current?.activity ?? (await adoptLiveInstance());
    if (!activity) return;
    await activity.update(props);
    current = { activity, props, phase: 'running' };
  } catch (error) {
    // Leave the unmatched activity up; it is still true, just less useful.
    reportWidgetFailure('la:update', error);
  }
}

/**
 * Re-push the props the activity already has, purely to make the extension
 * re-run its layout.
 *
 * The overdue flip is a `Date.now() >= overdueAtIso` comparison INSIDE the
 * serialized body, and nothing re-runs that body on a schedule:
 * `expo-widgets` hardcodes ActivityKit's `staleDate` to `nil`
 * (`ios/LiveActivity.swift`, `ios/LiveActivityFactory.swift`) and exposes no
 * way to set it, so a redraw only ever happens when something calls
 * `update()`. Without this the card never flips at all — measured apricot 13
 * minutes past the threshold, through several forced redraws.
 *
 * Running phase only: a receipt has no overdue state to reach, and a
 * clock-out in flight is about to replace the whole thing.
 */
export async function pokeOverdueRedraw(): Promise<void> {
  if (current?.phase !== 'running') return;
  try {
    await current.activity.update(current.props);
  } catch (error) {
    reportWidgetFailure('la:poke', error);
  }
}

/** A receipt that has outlived its own dismissal, and holds nothing back. */
function isSpentReceipt(handle: NonNullable<typeof current>): boolean {
  return (
    handle.receiptEndsAtMs !== undefined && Date.now() >= handle.receiptEndsAtMs
  );
}

/** A local clock-out is in flight — hold the activity until it settles. */
export function beginClockOut(): void {
  clockOutInFlight = true;
  if (current?.phase === 'running') current.phase = 'clockingOut';
}

/** The local clock-out failed; the entry is still running. */
export function abortClockOut(): void {
  clockOutInFlight = false;
  if (current?.phase === 'clockingOut') current.phase = 'running';
}

/**
 * Clock-out succeeded: swap the activity to the receipt in place, then end
 * it on a delay so it lingers ~90s. Both figures come off the server's own
 * clocked-out entry — a break passed separately could only disagree with
 * the row that was actually recorded.
 */
export async function completeWithReceipt(entry: TimeEntry): Promise<void> {
  // Nothing tracked means the process restarted mid-shift; the activity is
  // still up, so adopt it rather than leaving her clock-out with no receipt.
  const activity = current?.activity ?? (await adoptLiveInstance());
  const trackedProps = current?.props ?? null;
  const { clock_in_at: clockInAt, clock_out_at: clockOutAt } = entry;
  if (!activity) {
    current = null;
    clockOutInFlight = false;
    return;
  }

  if (!clockInAt || !clockOutAt) {
    current = null;
    clockOutInFlight = false;
    try {
      await activity.end('immediate');
    } catch (error) {
      reportWidgetFailure('la:receipt', error);
    }
    return;
  }

  // The handle STAYS, in `'receipt'` phase, for the whole linger. The same
  // clock-out that lands here also invalidates the running-entry query, and
  // `useLiveActivitySync` runs `endIfStillRunning` the moment it resolves
  // to null — which is always sooner than the 90s dismissal. Nulling `current`
  // here (as this did) left that orphan-guard nothing to defer to, so it ended
  // the receipt on the spot and the lock screen never showed it at all.
  current = {
    activity,
    // Only ever stashed, never rendered — the receipt props below are what
    // gets pushed. Synthesized when the restart took the originals.
    props:
      trackedProps ?? buildRunningProps(clockInAt, entry.timezone, '', null),
    phase: 'receipt',
    receiptEndsAtMs: Date.now() + RECEIPT_LINGER_MS,
  };
  clockOutInFlight = false;
  try {
    const minutes = computeWorkedMinutesFromInstants(
      clockInAt,
      new Date(clockOutAt).getTime(),
      entry.break_minutes
    );
    const duration = formatDuration(minutes);
    const props: OnTheClockProps = {
      // The tick is ornament, not copy — it belongs to the confirmation
      // moment in every language, so it is prepended rather than baked
      // into each locale's string.
      title: `✓ ${i18n.t('today:liveActivity.receiptTitle', {
        time: formatClockTime(clockOutAt, entry.timezone),
      })}`,
      phase: 'receipt',
      detail:
        entry.break_minutes > 0
          ? i18n.t('today:liveActivity.receiptBodyWithBreak', {
              duration,
              breakDuration: formatDuration(entry.break_minutes),
            })
          : i18n.t('today:liveActivity.receiptBody', { duration }),
      bodyUrl: Linking.createURL('/hours'),
      artUri: widgetArtUri('la-receipt-dark'),
    };
    await activity.update(props);
    // `end(after:)` only SCHEDULES the dismissal — it resolves at once — so
    // the handle is released by `receiptEndsAtMs` instead, once the receipt
    // has actually gone. Releasing it on that promise would reopen the race
    // this phase exists to close.
    await activity.end(
      { after: new Date(Date.now() + RECEIPT_LINGER_MS) },
      props
    );
  } catch (error) {
    // Nothing to recover: the entry is clocked out either way.
    current = null;
    reportWidgetFailure('la:receipt', error);
  }
}

/**
 * The running entry is gone but this device never clocked out — another
 * device did, or a parent corrected the record. The lock screen is now
 * claiming something false, so it goes at once.
 *
 * Called with `current === null` after a cold start (module state does not
 * survive the process), so it falls back to whatever instances the system
 * still holds. That can also catch a receipt left over from before the
 * restart, which is fine: it was about to expire anyway.
 *
 * A receipt whose own dismissal is already due is treated the same way: it
 * is a spent handle, and refusing to clear it would leave the NEXT shift's
 * clock-out with an activity nothing can ever end.
 */
export async function endIfStillRunning(): Promise<void> {
  // Survives the restart that `current` does not — see `clockOutInFlight`.
  if (clockOutInFlight) {
    return;
  }
  if (current && current.phase !== 'running' && !isSpentReceipt(current)) {
    return;
  }
  const activity = current?.activity ?? null;
  const generationAtEntry = startGeneration;
  current = null;
  try {
    if (activity) {
      await activity.end('immediate');
      return;
    }
    const factory = await getFactory();
    if (!factory) return;
    // A clock-in that began while we were resolving the factory owns the
    // activity now, and `getInstances()` cannot tell hers from an orphan —
    // so sweeping here ended the one she had just started, silently. That
    // is what made the receipt look flaky: by clock-out there was no
    // activity left to turn into one. Only an automated clock-in right
    // after launch is fast enough to land inside this await.
    if (current || startGeneration !== generationAtEntry) return;
    const instances = factory.getInstances();
    await Promise.all(instances.map(instance => instance.end('immediate')));
  } catch (error) {
    // Already ended, or activities unavailable.
    reportWidgetFailure('la:end', error);
  }
}
