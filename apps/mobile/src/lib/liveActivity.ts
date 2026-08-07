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
} | null = null;

/**
 * Test-only: forget the tracked activity. `endIfStillRunning` deliberately
 * will NOT clear a `'receipt'`-phase handle, so it cannot serve as a reset.
 */
export function resetLiveActivityForTests(): void {
  current = null;
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
    unmatchedNote: window
      ? null
      : i18n.t('today:liveActivity.noScheduledShift'),
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
  };
}

/**
 * Start the activity for a freshly created running entry. `shift` is
 * whatever was already matched at clock-in; the usual case is `null`,
 * because the clock-in response carries only a `shift_id` and the shift
 * itself arrives a moment later — see `updateOnShiftMatch`.
 */
export async function startOnTheClock(
  entry: TimeEntry,
  shift: ScheduledWindow | null,
  householdName: string
): Promise<void> {
  if (!entry.clock_in_at) return;
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
 * The shift the clock-in matched has finished loading: add the scheduled
 * finish and the progress bar. Ignored once anything else has happened to
 * the activity, and ignored when the figures would not change — this is
 * driven by a query subscription and must not update on every refetch.
 */
export async function updateOnShiftMatch(
  shift: ScheduledWindow,
  clockInAt: string,
  timeZone: string
): Promise<void> {
  if (current?.phase !== 'running') return;
  if (current.props.scheduledEndIso) return; // frozen — see module header
  try {
    const props = buildRunningProps(
      clockInAt,
      timeZone,
      current.props.household,
      shift
    );
    if (!props.scheduledEndIso) return;
    await current.activity.update(props);
    current.props = props;
  } catch (error) {
    // Leave the unmatched activity up; it is still true, just less useful.
    reportWidgetFailure('la:update', error);
  }
}

/** A local clock-out is in flight — hold the activity until it settles. */
export function beginClockOut(): void {
  if (current?.phase === 'running') current.phase = 'clockingOut';
}

/** The local clock-out failed; the entry is still running. */
export function abortClockOut(): void {
  if (current?.phase === 'clockingOut') current.phase = 'running';
}

/**
 * Clock-out succeeded: swap the activity to the receipt in place, then end
 * it on a delay so it lingers ~90s. Both figures come off the server's own
 * clocked-out entry — a break passed separately could only disagree with
 * the row that was actually recorded.
 */
export async function completeWithReceipt(entry: TimeEntry): Promise<void> {
  if (!current) return;
  const { activity, props: runningProps } = current;
  const { clock_in_at: clockInAt, clock_out_at: clockOutAt } = entry;

  if (!clockInAt || !clockOutAt) {
    current = null;
    try {
      await activity.end('immediate');
    } catch (error) {
      reportWidgetFailure('la:receipt', error);
    }
    return;
  }

  // The handle STAYS, in `'receipt'` phase, for the whole linger. The same
  // clock-out that lands here also invalidates the running-entry query, and
  // `AppBootstrap` runs `endIfStillRunning` the moment that refetch resolves
  // to null — which is always sooner than the 90s dismissal. Nulling `current`
  // here (as this did) left that orphan-guard nothing to defer to, so it ended
  // the receipt on the spot and the lock screen never showed it at all.
  current = { activity, props: runningProps, phase: 'receipt' };
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
    };
    await activity.update(props);
    // `end(after:)` only SCHEDULES the dismissal — it resolves at once — so
    // the handle is released on our own timer instead, once the receipt has
    // actually gone. Releasing it on that promise would reopen the same race.
    await activity.end(
      { after: new Date(Date.now() + RECEIPT_LINGER_MS) },
      props
    );
    setTimeout(() => {
      if (current?.activity === activity) current = null;
    }, RECEIPT_LINGER_MS);
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
 */
export async function endIfStillRunning(): Promise<void> {
  if (current && current.phase !== 'running') return;
  const activity = current?.activity ?? null;
  current = null;
  try {
    if (activity) {
      await activity.end('immediate');
      return;
    }
    const factory = await getFactory();
    if (!factory) return;
    await Promise.all(
      factory.getInstances().map(instance => instance.end('immediate'))
    );
  } catch (error) {
    // Already ended, or activities unavailable.
    reportWidgetFailure('la:end', error);
  }
}
