/**
 * @module lib/widgetSnapshot
 *
 * Builds the home-screen widgets' App Group payloads. Two halves:
 *
 * - **Builders** (`buildNextShiftPayload`, `buildTodaysCoverPayload`,
 *   `buildNannyWeekPayload`, `buildParentWeekPayload`) — pure, data in / props
 *   out, `nowMs` always injected. Everything user-visible is localized HERE
 *   (see `widgetSnapshot.types.ts`); the widget extension has no i18n runtime.
 * - **Apply** (`applyWidgetSnapshots`) — hands the props to `expo-widgets`.
 *   The widget instances are *registered* into this module by `src/widgets/`
 *   rather than imported from it, so nothing here pulls in
 *   `@expo/ui/swift-ui` and the builders stay testable without a native mock.
 *
 * The derivations deliberately mirror the in-app cards they shadow —
 * `NannyLiveStatusCard`'s per-carer bucketing and row ranking,
 * `ClockInCard`'s 60-minute arriving window, the Hours screen's
 * `sumEntryMinutes`/`scheduledMinutesFor`. A widget quoting a different
 * number than the screen behind it is worse than a widget saying less.
 */

import { SHIFT_KINDS } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { COVERING_SHIFT_STATUSES } from '@steadily-nanny/shared-types/uncoveredCare';
import { Platform } from 'react-native';
import { appIdentity } from '@/src/config/appIdentity';
import type { TimeEntry } from '@/src/domains/timesheet/types';
import { carerKeyOf } from '@/src/domains/timesheet/utils/carerKey';
import {
  formatClockTime,
  formatDuration,
} from '@/src/domains/timesheet/utils/duration';
import {
  scheduledMinutesFor,
  sumEntryMinutes,
} from '@/src/domains/timesheet/utils/entryMinutes';
import i18n from '@/src/i18n';
import { reportWidgetFailure } from '@/src/lib/expoWidgets';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { widgetArtUri } from '@/src/lib/widgetArt';
import type {
  CoverRowKind,
  CoverRowProps,
  NannyWeekWidgetProps,
  NextShiftRow,
  NextShiftState,
  NextShiftWidgetProps,
  ParentWeekWidgetProps,
  PendingResponseBanner,
  TodaysCoverWidgetProps,
  WeekStatusTone,
  WidgetPayload,
  WidgetRedirectProps,
  WidgetSnapshotBase,
  WidgetSnapshotSet,
  WidgetTargets,
  WidgetTimelineEntry,
} from './widgetSnapshot.types';

export {
  SNAPSHOT_AS_OF_MS,
  SNAPSHOT_DEGRADE_MS,
} from './widgetSnapshot.types';

/**
 * How far ahead of a shift start the "starting soon" state opens. Same figure
 * `ClockInCard` and `NannyLiveStatusCard` use for their arriving rows — they
 * each keep a private copy with a different carer filter, so this is a third
 * declaration of the same 60 minutes rather than a shared import. Consolidating
 * all three is a follow-up; changing one without the others is a bug.
 */
export const ARRIVING_WINDOW_MS = 60 * 60 * 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The PARENT leg: "who has the children" — a pending ask is a question, not
 * an answer, so this stays COVERING while the nanny leg
 * (`useWidgetSnapshotSync.ts`) uses SCHEDULED. */
const COVERING_STATUS_SET = new Set<string>(COVERING_SHIFT_STATUSES);

/** Row ranking, mirroring `NannyLiveStatusCard`'s KIND_ORDER. */
const KIND_ORDER: Record<CoverRowKind, number> = {
  live: 0,
  finished: 1,
  arriving: 2,
  scheduled: 3,
  gap: 4,
};

/**
 * Widgets are separate processes — a tap must re-enter the app through the
 * URL scheme, not the in-process router. Group segments (`(private)`,
 * `(tabs)`) are invisible in expo-router URLs, so these are the bare paths.
 */
export const WIDGET_DEEP_LINKS = {
  home: `${appIdentity.scheme}:///home`,
  hours: `${appIdentity.scheme}:///hours`,
  /** The Live Activity's clock-out affordance — opens ClockOutSheet on Today. */
  clockOut: `${appIdentity.scheme}:///home?clockOut=1`,
  shift: (shiftId: string) =>
    `${appIdentity.scheme}:///schedule/shifts/${shiftId}`,
} as const;

// ---------------------------------------------------------------------------
// Localized formatting primitives
// ---------------------------------------------------------------------------

/**
 * "Mia", "Mia & Jonah", "Mia, Jonah & Ada".
 *
 * Hand-rolled rather than `Intl.ListFormat`, for two reasons that both bite:
 * CLDR's Spanish list pattern always joins with "y", but Spanish requires "e"
 * before a word starting with an i-sound ("Iris e Inés"), so ListFormat would
 * be wrong exactly where it matters; and English here wants the plan's
 * ampersand, which no ListFormat style produces.
 */
export function formatNameList(names: string[]): string {
  const clean = names.map(name => name.trim()).filter(name => name.length > 0);
  if (clean.length === 0) return '';
  const last = clean[clean.length - 1];
  if (clean.length === 1 || last === undefined) return clean[0] ?? '';
  const head = clean.slice(0, -1).join(', ');
  return `${head} ${conjunctionFor(last)} ${last}`;
}

/**
 * The word joining the last two names. Spanish swaps "y" → "e" before an
 * i-sound: a leading "i"/"í", or "hi" that is not the diphthong "hie"
 * ("hierro" keeps "y"). English uses "&" — shorter, and the plan's copy.
 */
function conjunctionFor(nextWord: string): string {
  if (!i18n.language?.startsWith('es')) return '&';
  const normalized = nextWord
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const startsWithISound =
    normalized.startsWith('i') ||
    (normalized.startsWith('hi') && !normalized.startsWith('hie'));
  return startsWithISound ? 'e' : 'y';
}

/** "08:00–17:00" in the household's zone, device 12/24h preference. */
function timeRange(startsAt: string, endsAt: string, timeZone: string): string {
  return i18n.t('today:widgets.timeRange', {
    start: formatClockTime(startsAt, timeZone),
    end: formatClockTime(endsAt, timeZone),
  });
}

/** "Today" / "Tomorrow" / "Thu" — relative to the household's local date. */
function dayLabel(
  iso: string,
  timeZone: string,
  todayLocalDate: string
): string {
  const localDate = localDateInZone(timeZone, new Date(iso));
  if (localDate === todayLocalDate) return i18n.t('today:widgets.dayToday');
  if (localDate === addLocalDays(todayLocalDate, 1)) {
    return i18n.t('today:widgets.dayTomorrow');
  }
  try {
    return new Intl.DateTimeFormat(i18n.language, {
      weekday: 'short',
      timeZone,
    }).format(new Date(iso));
  } catch {
    return localDate;
  }
}

/** "As of 08:02" — the widget shows it only past `SNAPSHOT_AS_OF_MS`. */
function asOfLabel(generatedAtIso: string, timeZone: string): string {
  return i18n.t('today:widgets.asOf', {
    time: formatClockTime(generatedAtIso, timeZone),
  });
}

// ---------------------------------------------------------------------------
// N2 — nanny "Next shift"
// ---------------------------------------------------------------------------

/** One of her upcoming shifts, already resolved to its household and children. */
export interface NannyShiftInput {
  id: string;
  startsAt: string;
  endsAt: string;
  /** Never dropped from the widget — multi-household wrong-door risk. */
  householdName: string;
  /** The household's zone, not the device's. */
  timeZone: string;
  childNames: string[];
  /** True when this shift is waiting on HER acceptance (`pending` + assigned to her). */
  needsResponse: boolean;
}

export interface NextShiftInput {
  nowMs: number;
  /** The active household's zone — used for "Today"/"Tomorrow" bucketing only. */
  timeZone: string;
  /** False when nothing has ever synced (signed out, or a cold cache). */
  synced: boolean;
  running: {
    clockInAt: string;
    householdName: string;
    timeZone: string;
  } | null;
  /** Her upcoming shifts across every household. Order does not matter. */
  shifts: NannyShiftInput[];
}

function nextShiftRow(
  shift: NannyShiftInput,
  todayLocalDate: string
): NextShiftRow {
  const children = formatNameList(shift.childNames);
  return {
    dayLabel: dayLabel(shift.startsAt, shift.timeZone, todayLocalDate),
    timeRange: timeRange(shift.startsAt, shift.endsAt, shift.timeZone),
    householdName: shift.householdName,
    childrenLine: children.length > 0 ? children : null,
  };
}

/**
 * The schedule-derived state at an arbitrary instant. Used for the current
 * props AND for every timeline entry, so a widget three hours from now shows
 * exactly what the app would show if it were open then.
 */
function scheduleStateAt(
  shifts: NannyShiftInput[],
  atMs: number,
  todayLocalDate: string
): NextShiftState {
  const upcoming = shifts
    .filter(shift => new Date(shift.endsAt).getTime() > atMs)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const next = upcoming[0];
  if (!next) {
    return {
      kind: 'empty',
      title: i18n.t('today:widgets.nextShift.emptyTitle'),
      body: i18n.t('today:widgets.nextShift.emptyBody'),
    };
  }

  const startMs = new Date(next.startsAt).getTime();
  const children = formatNameList(next.childNames);
  const childrenLine = children.length > 0 ? children : null;

  // Already started and she is not on the clock. A nudge, never "Late" — the
  // snapshot cannot verify she isn't already clocked in elsewhere.
  if (atMs >= startMs) {
    return {
      kind: 'shiftStarted',
      title: i18n.t('today:widgets.nextShift.startedTitle'),
      body: i18n.t('today:widgets.nextShift.startedBody'),
      householdName: next.householdName,
    };
  }

  if (startMs - atMs <= ARRIVING_WINDOW_MS) {
    return {
      kind: 'startingSoon',
      title: i18n.t('today:widgets.nextShift.startingSoonTitle'),
      time: formatClockTime(next.startsAt, next.timeZone),
      householdName: next.householdName,
      childrenLine,
    };
  }

  return {
    kind: 'nextShift',
    title: i18n.t('today:widgets.nextShift.title'),
    // Two rows: `systemMedium` shows both, `systemSmall` renders rows[0].
    rows: upcoming
      .slice(0, 2)
      .map(shift => nextShiftRow(shift, todayLocalDate)),
  };
}

function pendingBannerFor(
  shifts: NannyShiftInput[],
  atMs: number,
  todayLocalDate: string
): PendingResponseBanner | null {
  const pending = shifts
    .filter(
      shift => shift.needsResponse && new Date(shift.endsAt).getTime() > atMs
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (!pending) return null;
  return {
    label: i18n.t('today:widgets.nextShift.needsResponse'),
    detail: i18n.t('today:widgets.nextShift.needsResponseDetail', {
      day: dayLabel(pending.startsAt, pending.timeZone, todayLocalDate),
      start: formatClockTime(pending.startsAt, pending.timeZone),
      end: formatClockTime(pending.endsAt, pending.timeZone),
    }),
    deepLink: WIDGET_DEEP_LINKS.shift(pending.id),
  };
}

/**
 * NextShift is the one surface whose art changes with its state, so the
 * payload picks the file and the body just renders whatever it is handed.
 * Mirrors the widget's own `showArt` condition — keep the two in step.
 */
function nextShiftArt(
  kind: NextShiftState['kind']
): Pick<WidgetSnapshotBase, 'artLightUri' | 'artDarkUri'> {
  if (kind === 'startingSoon') {
    return {
      artLightUri: widgetArtUri('startingsoon-light'),
      artDarkUri: widgetArtUri('startingsoon-dark'),
    };
  }
  if (kind === 'empty' || kind === 'neverSynced') {
    return {
      artLightUri: widgetArtUri('empty-light'),
      artDarkUri: widgetArtUri('empty-dark'),
    };
  }
  // Data-dense and state-colored states stay typographic, per spec §8.
  return { artLightUri: null, artDarkUri: null };
}

export function buildNextShiftPayload(
  input: NextShiftInput
): WidgetPayload<NextShiftWidgetProps> {
  const { nowMs, timeZone, synced, running, shifts } = input;
  const generatedAtIso = new Date(nowMs).toISOString();
  const todayLocalDate = localDateInZone(timeZone, new Date(nowMs));
  const base = {
    generatedAtIso,
    deepLink: WIDGET_DEEP_LINKS.home,
    asOfLabel: asOfLabel(generatedAtIso, timeZone),
  };

  if (!synced) {
    return {
      props: {
        ...base,
        ...nextShiftArt('neverSynced'),
        pending: null,
        state: {
          kind: 'neverSynced',
          title: i18n.t('today:widgets.neverSyncedTitle'),
          body: i18n.t('today:widgets.neverSyncedBody'),
        },
      },
      timeline: [],
    };
  }

  const pending = pendingBannerFor(shifts, nowMs, todayLocalDate);

  // On the clock: a SUMMARY only. The Live Activity owns the figures; the
  // widget repeating them would just be a second thing to get out of sync.
  // Clock-derived, so no timeline — only a fresh snapshot can move it.
  if (running) {
    return {
      props: {
        ...base,
        ...nextShiftArt('onClock'),
        pending,
        state: {
          kind: 'onClock',
          title: i18n.t('today:widgets.nextShift.onClockTitle'),
          detail: i18n.t('today:widgets.nextShift.onClockDetail', {
            time: formatClockTime(running.clockInAt, running.timeZone),
          }),
          householdName: running.householdName,
        },
      },
      timeline: [],
    };
  }

  const propsAt = (atMs: number): NextShiftWidgetProps => {
    const state = scheduleStateAt(shifts, atMs, todayLocalDate);
    return {
      ...base,
      ...nextShiftArt(state.kind),
      pending: pendingBannerFor(shifts, atMs, todayLocalDate),
      state,
    };
  };

  return {
    props: propsAt(nowMs),
    timeline: scheduleTransitionInstants(shifts, nowMs).map(atMs => ({
      dateIso: new Date(atMs).toISOString(),
      props: propsAt(atMs),
    })),
  };
}

/**
 * The instants at which the schedule-derived state changes on its own:
 * `start − 60min` (starting soon), `start` (the clock-in nudge) and `end`
 * (back to schedule truth / the shift after it). Only future instants, and
 * only for shifts near enough to matter — WidgetKit budgets reloads, so this
 * covers the next two shifts rather than the whole fortnight.
 */
function scheduleTransitionInstants(
  shifts: NannyShiftInput[],
  nowMs: number
): number[] {
  const upcoming = shifts
    .filter(shift => new Date(shift.endsAt).getTime() > nowMs)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 2);

  const instants = upcoming.flatMap(shift => {
    const startMs = new Date(shift.startsAt).getTime();
    return [
      startMs - ARRIVING_WINDOW_MS,
      startMs,
      new Date(shift.endsAt).getTime(),
    ];
  });

  return [...new Set(instants.filter(atMs => atMs > nowMs))].sort(
    (a, b) => a - b
  );
}

// ---------------------------------------------------------------------------
// P1 — parent "Today's cover"
// ---------------------------------------------------------------------------

export interface CoverShiftInput {
  id: string;
  carerId: string | null;
  startsAt: string;
  endsAt: string;
  localDate: string;
  /** Only `COVERING_SHIFT_STATUSES` count as cover. */
  status: string;
  kind?: string;
  childNames: string[];
}

export interface TodaysCoverInput {
  nowMs: number;
  /** The household's zone. */
  timeZone: string;
  householdName: string;
  entries: TimeEntry[];
  shifts: CoverShiftInput[];
  /** `carer_id` → display name, resolved from household members. */
  namesByCarerId: Record<string, string>;
  /** Coverage gaps for today, from the day thread. */
  gaps: { startsAt: string; endsAt: string }[];
}

function shiftRowKey(
  shift: Pick<CoverShiftInput, 'id' | 'kind' | 'carerId'>
): string {
  if (shift.kind === SHIFT_KINDS.PARENT_COVER) return 'shift-parent_cover';
  // Unlike `time_entries` (058), `shifts` carries no `household_member_id`/
  // `carer_display_name` snapshot, so a departed carer's shift has no
  // identity beyond the row itself once `carer_id` goes NULL. Falling back
  // to `shift.id` (instead of the literal string 'unassigned') keeps two
  // different departed carers' shifts from merging into one "Carer" row.
  return `shift-${shift.carerId ?? shift.id}`;
}

function pickCoverShift(
  shifts: CoverShiftInput[],
  nowMs: number
): CoverShiftInput | undefined {
  const covering = shifts
    .filter(shift => COVERING_STATUS_SET.has(shift.status))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (covering.length === 0) return undefined;
  return (
    covering.find(shift => Date.parse(shift.endsAt) > nowMs) ??
    covering[covering.length - 1]
  );
}

/** "Sarah is with Mia & Jonah", or "Sarah is here" when the shift has no children. */
function presenceTitle(name: string, childNames: string[]): string {
  const children = formatNameList(childNames);
  return children.length > 0
    ? i18n.t('today:widgets.cover.withChildren', { name, children })
    : i18n.t('today:widgets.cover.isHere', { name });
}

/** "Sarah · due 08:00–17:00" — the schedule truth a stale row falls back to. */
function dueTitle(
  name: string,
  shift: CoverShiftInput | undefined,
  timeZone: string
): string | null {
  if (!shift) return null;
  return i18n.t('today:widgets.cover.due', {
    name,
    start: formatClockTime(shift.startsAt, timeZone),
    end: formatClockTime(shift.endsAt, timeZone),
  });
}

export function buildTodaysCoverPayload(
  input: TodaysCoverInput
): WidgetPayload<TodaysCoverWidgetProps> {
  const { nowMs, timeZone, householdName, entries, shifts, namesByCarerId } =
    input;
  const generatedAtIso = new Date(nowMs).toISOString();
  const today = localDateInZone(timeZone, new Date(nowMs));
  const fallbackName = i18n.t('today:carerFallback');
  const nameFor = (carerId: string | null, snapshot?: string | null) =>
    (carerId ? namesByCarerId[carerId]?.trim() : undefined) ||
    snapshot?.trim() ||
    fallbackName;

  const todayShifts = shifts.filter(
    shift => shift.localDate === today && COVERING_STATUS_SET.has(shift.status)
  );
  const shiftById = new Map(todayShifts.map(shift => [shift.id, shift]));
  const coveringShiftFor = (carerId: string | null) =>
    pickCoverShift(
      todayShifts.filter(shift => shift.carerId === carerId),
      nowMs
    );

  // Bucket by the same carer identity rule the week screens use. A running
  // entry counts whatever its `local_date` says — "on the clock" is about now.
  // Voided rows never count as coverage (069) — they stay on the Hours screen
  // struck through, but a withdrawn clock-in did not happen.
  const buckets = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    if (entry.status === 'voided') continue;
    if (entry.local_date !== today && entry.status !== 'running') continue;
    const key = carerKeyOf(entry);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }

  const rows: CoverRowProps[] = [];
  const sortNames = new Map<string, string>();
  /** Carers their own entries already describe — their shift adds nothing. */
  const covered = new Set<string>();
  /** Shifts an entry already clocked against — the `carer_id` match above
   * goes blind the moment a departed carer's `carer_id` is NULL on both
   * rows, but `shift_id` on the entry survives account deletion untouched
   * (058's module doc). Without this a departed carer's own shift renders
   * a second "Carer · due …" row next to her name-bearing entry row. */
  const coveredShiftIds = new Set<string>();

  for (const [key, bucket] of buckets) {
    const first = bucket[0];
    if (!first) continue;
    if (first.carer_id) covered.add(first.carer_id);
    for (const entry of bucket) {
      if (entry.shift_id) coveredShiftIds.add(entry.shift_id);
    }
    const name = nameFor(first.carer_id, first.carer_display_name);
    sortNames.set(key, name);
    const shift =
      (first.shift_id ? shiftById.get(first.shift_id) : undefined) ??
      coveringShiftFor(first.carer_id);
    const staleTitle = dueTitle(name, shift, timeZone);

    const running = bucket.find(
      entry => entry.status === 'running' && entry.clock_in_at
    );
    if (running?.clock_in_at) {
      const title = presenceTitle(name, shift?.childNames ?? []);
      rows.push({
        key,
        kind: 'live',
        title,
        detail: i18n.t('today:widgets.cover.liveDetail', {
          time: formatClockTime(running.clock_in_at, timeZone),
        }),
        staleTitle: staleTitle ?? title,
        staleDetail: null,
        isLiveDot: true,
      });
      continue;
    }

    const lastOut = bucket
      .filter(entry => entry.clock_out_at)
      .sort((a, b) =>
        (b.clock_out_at ?? '').localeCompare(a.clock_out_at ?? '')
      )[0];
    if (!lastOut?.clock_out_at) continue;
    const title = i18n.t('today:widgets.cover.finished', {
      name,
      time: formatClockTime(lastOut.clock_out_at, timeZone),
    });
    rows.push({
      key,
      kind: 'finished',
      title,
      // Her entries for TODAY only, matching NannyLiveStatusCard.
      detail: formatDuration(
        sumEntryMinutes(
          bucket.filter(entry => entry.local_date === today),
          nowMs
        )
      ),
      staleTitle: staleTitle ?? title,
      staleDetail: null,
      isLiveDot: false,
    });
  }

  // Today's shifts fill in the carers who have not clocked anything yet.
  const shiftBuckets = new Map<string, CoverShiftInput[]>();
  for (const shift of todayShifts) {
    if (shift.carerId && covered.has(shift.carerId)) continue;
    if (coveredShiftIds.has(shift.id)) continue;
    const key = shiftRowKey(shift);
    const bucket = shiftBuckets.get(key);
    if (bucket) bucket.push(shift);
    else shiftBuckets.set(key, [shift]);
  }

  for (const [key, bucket] of shiftBuckets) {
    const next = pickCoverShift(bucket, nowMs);
    if (!next) continue;
    const name =
      next.kind === SHIFT_KINDS.PARENT_COVER
        ? i18n.t('schedule:cover.parentCoveringRow')
        : nameFor(next.carerId);
    sortNames.set(key, name);
    const startMs = new Date(next.startsAt).getTime();
    const arriving = nowMs < startMs && startMs - nowMs <= ARRIVING_WINDOW_MS;
    const title = arriving
      ? i18n.t('today:widgets.cover.arriving', {
          name,
          start: formatClockTime(next.startsAt, timeZone),
        })
      : (dueTitle(name, next, timeZone) ?? name);
    rows.push({
      key,
      kind: arriving ? 'arriving' : 'scheduled',
      title,
      detail: null,
      // Schedule truth already — nothing to degrade to.
      staleTitle: title,
      staleDetail: null,
      isLiveDot: false,
    });
  }

  for (const [index, gap] of input.gaps.entries()) {
    const title = i18n.t('today:widgets.cover.noCoverRange', {
      start: formatClockTime(gap.startsAt, timeZone),
      end: formatClockTime(gap.endsAt, timeZone),
    });
    const key = `gap-${index}`;
    sortNames.set(key, title);
    rows.push({
      key,
      kind: 'gap',
      title,
      detail: null,
      staleTitle: title,
      staleDetail: null,
      isLiveDot: false,
    });
  }

  rows.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (sortNames.get(a.key) ?? '').localeCompare(sortNames.get(b.key) ?? '')
  );

  return {
    props: {
      generatedAtIso,
      deepLink: WIDGET_DEEP_LINKS.hours,
      asOfLabel: asOfLabel(generatedAtIso, timeZone),
      // Only ever rendered on this widget's fallback/empty state, so the
      // dusk illustration is the only one it can need.
      artLightUri: widgetArtUri('empty-light'),
      artDarkUri: widgetArtUri('empty-dark'),
      title: i18n.t('today:widgets.cover.title'),
      householdName,
      rows,
      moreLabel:
        rows.length > 1
          ? i18n.t('today:widgets.cover.more', { count: rows.length - 1 })
          : null,
      emptyTitle: i18n.t('today:widgets.cover.emptyTitle'),
      emptyBody: i18n.t('today:widgets.cover.emptyBody'),
    },
    timeline: [],
  };
}

// ---------------------------------------------------------------------------
// N3 / P2 — "This week"
// ---------------------------------------------------------------------------

export interface WeekTimesheetInput {
  status: 'open' | 'submitted' | 'approved' | 'queried';
  total_minutes: number;
  updated_at: string;
  approved_at: string | null;
}

export interface WeekHoursInput {
  nowMs: number;
  timeZone: string;
  householdName: string;
  /** One carer's entries for the week — never the whole household's. */
  entries: TimeEntry[];
  timesheet: WeekTimesheetInput | null;
}

/** "today" / "3 days" — how long a submitted week has been waiting. */
function ageLabel(sinceIso: string, nowMs: number): string {
  const days = Math.max(
    0,
    Math.floor((nowMs - new Date(sinceIso).getTime()) / MS_PER_DAY)
  );
  return days === 0
    ? i18n.t('hours:widgets.ageToday')
    : i18n.t('hours:widgets.ageDays', { count: days });
}

function weekStatusLabel(
  timesheet: WeekTimesheetInput | null,
  timeZone: string,
  nowMs: number
): string {
  if (!timesheet || timesheet.status === 'open') {
    return i18n.t('hours:statusNotSubmitted');
  }
  if (timesheet.status === 'approved') return i18n.t('hours:statusApproved');
  if (timesheet.status === 'queried') return i18n.t('hours:statusQueried');

  let day = '';
  try {
    day = new Intl.DateTimeFormat(i18n.language, {
      weekday: 'long',
      timeZone,
    }).format(new Date(timesheet.updated_at));
  } catch {
    day = '';
  }
  return i18n.t('hours:widgets.statusSubmittedAged', {
    day,
    age: ageLabel(timesheet.updated_at, nowMs),
  });
}

function weekBase(input: WeekHoursInput) {
  const { nowMs, timeZone, householdName, entries, timesheet } = input;
  const generatedAtIso = new Date(nowMs).toISOString();
  const scheduled = scheduledMinutesFor(entries);
  return {
    generatedAtIso,
    deepLink: WIDGET_DEEP_LINKS.hours,
    asOfLabel: asOfLabel(generatedAtIso, timeZone),
    // As TodaysCover: the week widgets show art on their fallback state only.
    artLightUri: widgetArtUri('empty-light'),
    artDarkUri: widgetArtUri('empty-dark'),
    title: i18n.t('hours:widgets.title'),
    householdName,
    hours: formatDuration(sumEntryMinutes(entries, nowMs)),
    scheduledLine:
      scheduled === null
        ? null
        : i18n.t('hours:widgets.scheduled', {
            duration: formatDuration(scheduled),
          }),
    statusLabel: weekStatusLabel(timesheet, timeZone, nowMs),
  };
}

/** Keyed by `timesheet.status`, so a new status is a compile error, not a grey pill. */
const WEEK_STATUS_TONES: Record<WeekTimesheetInput['status'], WeekStatusTone> =
  {
    open: 'muted',
    submitted: 'ochre',
    approved: 'green',
    queried: 'terracotta',
  };

export function buildNannyWeekPayload(
  input: WeekHoursInput
): WidgetPayload<NannyWeekWidgetProps> {
  const base = weekBase(input);
  const { timesheet, entries, nowMs } = input;

  // "Did my week come back intact?" — the one figure she checks after
  // approval. `total_minutes` on an approved sheet is what was approved; the
  // entries still sum to what she submitted.
  const submittedMinutes = sumEntryMinutes(entries, nowMs);
  const adjusted =
    timesheet?.status === 'approved' &&
    timesheet.total_minutes !== submittedMinutes;

  return {
    props: {
      ...base,
      tone: WEEK_STATUS_TONES[timesheet?.status ?? 'open'],
      adjustmentNote: adjusted
        ? i18n.t('hours:widgets.adjusted', {
            submitted: formatDuration(submittedMinutes),
            approved: formatDuration(timesheet.total_minutes),
          })
        : null,
    },
    timeline: [],
  };
}

/**
 * The other persona's widget. `role` is whose widget this is — a nanny widget
 * sitting on a parent's home screen gets `'nanny'` — and the copy names the
 * widget they should have added instead. No root prop, so every body falls
 * into its never-synced branch and renders these two strings there.
 */
export function buildRedirectPayload(input: {
  nowMs: number;
  timeZone: string;
  role: 'nanny' | 'parent';
}): WidgetPayload<WidgetRedirectProps> {
  const generatedAtIso = new Date(input.nowMs).toISOString();
  return {
    props: {
      generatedAtIso,
      deepLink: WIDGET_DEEP_LINKS.home,
      asOfLabel: asOfLabel(generatedAtIso, input.timeZone),
      artLightUri: null,
      artDarkUri: null,
      fallbackTitle: i18n.t(`today:widgets.redirect.${input.role}.title`),
      fallbackBody: i18n.t(`today:widgets.redirect.${input.role}.body`),
    },
    timeline: [],
  };
}

/** Hours + neutral status. No approval nag (Priya), and never money. */
export function buildParentWeekPayload(
  input: WeekHoursInput
): WidgetPayload<ParentWeekWidgetProps> {
  return { props: weekBase(input), timeline: [] };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

const targets: WidgetTargets = {};

/**
 * Called once by each widget module in `src/widgets/` at import time. The
 * dependency points that way (widgets → here) so this module never imports
 * `@expo/ui/swift-ui`, which cannot load outside the native runtime.
 */
export function registerWidgetTargets(next: WidgetTargets): void {
  Object.assign(targets, next);
}

/** Test-only: drop every registration so cases don't leak into each other. */
export function resetWidgetTargets(): void {
  for (const key of Object.keys(targets)) {
    delete targets[key as keyof WidgetTargets];
  }
}

function applyOne<Props extends object>(
  name: string,
  target:
    | {
        updateSnapshot(props: Props): void;
        updateTimeline(entries: { date: Date; props: Props }[]): void;
      }
    | undefined,
  payload: WidgetPayload<Props> | undefined
): void {
  if (!target || !payload) return;
  // The try/catch stays regardless of `widgetSafeProps`: this runs in an
  // `AppBootstrap` effect, so an escaping throw takes every authenticated
  // screen down to the root error boundary. Widgets are decoration; the app
  // is not.
  try {
    target.updateSnapshot(widgetSafeProps(payload.props));
    if (payload.timeline.length > 0) {
      target.updateTimeline(
        payload.timeline.map((entry: WidgetTimelineEntry<Props>) => ({
          date: new Date(entry.dateIso),
          props: widgetSafeProps(entry.props),
        }))
      );
    }
  } catch (error) {
    reportWidgetFailure(`apply:${name}`, error);
  }
}

/**
 * Drops every `null`/`undefined`, recursively, on the way into `expo-widgets`.
 *
 * `updateTimeline` stores the props verbatim with `UserDefaults.set`, and a JS
 * `null` reaches it as `NSNull` (`JavaScriptValue.getAny()` in
 * expo-modules-jsi maps both `null` and `undefined` to `NSNull()`). `NSNull`
 * is not a property-list type, so the whole write throws an ObjC
 * `NSInvalidArgumentException` — surfacing in JS as the reasonless
 * `Exception in HostFunction: <unknown>`, before a single byte is stored.
 * That is why no `__expo_widgets_*_timeline` key had ever appeared in the App
 * Group. Absent keys read back as `undefined` in the widget's JS runtime,
 * which every `?.`/`??`/truthiness read in `src/widgets/` already handles —
 * so no widget may compare a prop with `=== null`.
 *
 * The builders keep their `| null` fields: `null` is the honest shape for
 * "computed, and there is nothing there", and the tests assert it. This is a
 * wire-format concern, and it belongs at the wire.
 */
export function widgetSafeProps<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter(item => item !== null && item !== undefined)
      .map(item => widgetSafeProps(item)) as T;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null && item !== undefined)
        .map(([key, item]) => [key, widgetSafeProps(item)])
    ) as T;
  }
  return value;
}

/**
 * Pushes built payloads into WidgetKit. A key absent from `set` is LEFT ALONE
 * rather than cleared — a garbage-collected query cache must never blank a
 * widget that was showing the right thing a minute ago.
 */
export function applyWidgetSnapshots(set: WidgetSnapshotSet): void {
  if (Platform.OS !== 'ios') return;
  applyOne('nextShift', targets.nextShift, set.nextShift);
  applyOne('todaysCover', targets.todaysCover, set.todaysCover);
  applyOne('nannyWeek', targets.nannyWeek, set.nannyWeek);
  applyOne('parentWeek', targets.parentWeek, set.parentWeek);
}
