/**
 * @module lib/widgetSnapshot.types
 *
 * THE WIDGET CONTRACT. `widgetSnapshot.ts` (the app side) writes these props
 * into the App Group; the `'widget'` components (`src/widgets/`) render them.
 *
 * Two rules make this contract work, and both are load-bearing:
 *
 * 1. **Every user-visible string is pre-localized here.** The widget extension
 *    has no i18next runtime and no access to the app's language store, so a
 *    widget component must render what it is given, verbatim. Strings stay
 *    split into their own fields (title / detail / householdName /
 *    childrenLine) so a component can DROP a line under space pressure without
 *    having to re-compose one.
 * 2. **Everything is JSON round-trippable.** No `Date`, no functions — dates
 *    are ISO strings, and the apply layer converts timeline `dateIso` to a
 *    `Date` at the boundary.
 *
 * Staleness is the widget's job, not the app's: a widget compares
 * `generatedAtIso` against "now" at render time and degrades itself. The app
 * cannot do this because the snapshot is written once and read for hours.
 */
import type { WidgetTimelineEntry as NativeTimelineEntry } from 'expo-widgets';

/**
 * Past this age, a snapshot's clock-derived claims ("is on the clock now")
 * are no longer trustworthy and rows must fall back to schedule truth
 * (`staleTitle`/`staleDetail`). 45min is the plan's figure: long enough that a
 * normal foregrounding refreshes first, short enough that a widget never
 * asserts someone is working when they clocked out an hour ago.
 */
export const SNAPSHOT_DEGRADE_MS = 45 * 60 * 1000;

/**
 * Past this age, the widget additionally shows `asOfLabel` in its footer, so
 * a stale surface says WHEN it was right rather than silently looking current.
 */
export const SNAPSHOT_AS_OF_MS = 2 * 60 * 60 * 1000;

/** Every payload carries the instant it was built. See the module header. */
export interface WidgetSnapshotBase {
  generatedAtIso: string;
  /** Where a tap on the widget body goes (full `scheme://` URL). */
  deepLink: string;
  /** Pre-localized "As of 08:02" — shown only past `SNAPSHOT_AS_OF_MS`. */
  asOfLabel: string;
  /**
   * `file://` URIs of the illustration for this state, one per appearance —
   * the widget body picks with `env.colorScheme`. Both null means "no image",
   * which is the FALLBACK, not an error: illustrations carry zero
   * information, so every layout reads correctly with them absent and skips
   * the `Image` entirely. Only the states in the redesign spec's §8 table
   * ever get a non-null URI; every other state sends null.
   *
   * `uiImage` is a synchronous read on the render path, so each file stays
   * under ~150KB.
   */
  artLightUri: string | null;
  artDarkUri: string | null;
  /**
   * Overrides for the never-synced fallback branch every widget body opens
   * with. Present ONLY on a redirect payload (see `WidgetRedirectProps`);
   * absent everywhere else, where the body keeps its English literal.
   */
  fallbackTitle?: string;
  fallbackBody?: string;
}

/**
 * The wrong-persona payload: base shell, no root data, and the two strings
 * the fallback branch renders instead of "Open Steadily to get started".
 * Written by the snapshot sync to the OTHER role's widgets once the app knows
 * which role the signed-in user is — iOS cannot hide them from the gallery, so
 * a parent who adds a nanny widget gets told what it is and how to remove it.
 */
export interface WidgetRedirectProps extends WidgetSnapshotBase {
  fallbackTitle: string;
  fallbackBody: string;
}

/** A scheduled future rendering of a widget. `dateIso` is the transition instant. */
export interface WidgetTimelineEntry<Props extends object> {
  dateIso: string;
  props: Props;
}

/**
 * The slice of `expo-widgets`' `Widget` class the apply layer needs. Declaring
 * it structurally (rather than importing the class) keeps `widgetSnapshot.ts`
 * free of a native-module import, so its tests need no `mock.module`.
 */
export interface WidgetTarget<Props extends object> {
  updateSnapshot(props: Props): void;
  updateTimeline(entries: NativeTimelineEntry<Props>[]): void;
}

/** What a builder produces: the now-props plus any scheduled future props. */
export interface WidgetPayload<Props extends object> {
  props: Props;
  /** Empty means "snapshot only" — the widget holds these props until the next sync. */
  timeline: WidgetTimelineEntry<Props>[];
}

// ---------------------------------------------------------------------------
// N2 — nanny "Next shift"
// ---------------------------------------------------------------------------

/** One upcoming shift. `householdName` is NEVER empty (multi-household wrong-door risk). */
export interface NextShiftRow {
  /** "Today" / "Tomorrow" / "Thu" — already localized. */
  dayLabel: string;
  /** "08:00–17:00" in the household's zone. */
  timeRange: string;
  householdName: string;
  /** "Mia & Jonah". Home-screen families only; drop this line FIRST under space pressure. */
  childrenLine: string | null;
}

/**
 * The ochre "Needs your response" pill. Modelled as a field on the props
 * rather than a member of `NextShiftState` because it renders ALONGSIDE the
 * next-shift content, not instead of it (see the plan's N2 section).
 */
export interface PendingResponseBanner {
  /** "Needs your response" */
  label: string;
  /** "Thu 08:00–17:00" */
  detail: string;
  /** Deep link to that shift's detail screen. */
  deepLink: string;
}

export type NextShiftState =
  /** No snapshot has ever been written — the app has not been opened/signed in. */
  | { kind: 'neverSynced'; title: string; body: string }
  /** Signed in, nothing scheduled in the look-ahead window. */
  | { kind: 'empty'; title: string; body: string }
  /** Clocked in. Deliberately a SUMMARY — never duplicates the Live Activity's figures. */
  | { kind: 'onClock'; title: string; detail: string; householdName: string }
  /** Timeline entry at `starts_at − 60min`. Mirrors ClockInCard's arriving window. */
  | {
      kind: 'startingSoon';
      title: string;
      time: string;
      householdName: string;
      childrenLine: string | null;
    }
  /** Timeline entry at `starts_at`. Nudge tone only — never "Late" (the snapshot may be stale). */
  | { kind: 'shiftStarted'; title: string; body: string; householdName: string }
  /** The default: the next 1–2 shifts. `systemSmall` renders `rows[0]` only. */
  | { kind: 'nextShift'; title: string; rows: NextShiftRow[] };

export interface NextShiftWidgetProps extends WidgetSnapshotBase {
  state: NextShiftState;
  pending: PendingResponseBanner | null;
}

// ---------------------------------------------------------------------------
// P1 — parent "Today's cover"
// ---------------------------------------------------------------------------

/** Row ranking, mirroring `NannyLiveStatusCard`'s KIND_ORDER (gap sorts with `live`). */
export type CoverRowKind =
  | 'live'
  | 'finished'
  | 'arriving'
  | 'scheduled'
  | 'gap';

/**
 * `title`/`detail` are the fresh, clock-derived claim. `staleTitle`/`staleDetail`
 * are the schedule-truth fallback the widget swaps in past `SNAPSHOT_DEGRADE_MS`
 * — for `arriving`/`scheduled`/`gap` rows the two are identical, because those
 * were schedule truth to begin with.
 */
export interface CoverRowProps {
  /** Stable per-carer key, so rows don't jump between refreshes. */
  key: string;
  kind: CoverRowKind;
  /** "Sarah is with Mia & Jonah" / "No cover 15:00–18:00" */
  title: string;
  /** "On the clock since 08:12" — null when the title says everything. */
  detail: string | null;
  staleTitle: string;
  staleDetail: string | null;
  /** True when this row asserts something only a fresh snapshot can know. */
  isLiveDot: boolean;
}

export interface TodaysCoverWidgetProps extends WidgetSnapshotBase {
  title: string;
  householdName: string;
  rows: CoverRowProps[];
  /** "+2 more" for `systemSmall`, which shows `rows[0]` only. Null when there is no overflow. */
  moreLabel: string | null;
  emptyTitle: string;
  emptyBody: string;
}

// ---------------------------------------------------------------------------
// N3 / P2 — "This week"
// ---------------------------------------------------------------------------

interface WeekHoursBase extends WidgetSnapshotBase {
  title: string;
  householdName: string;
  /** "32h 15m" */
  hours: string;
  /** "of 38h scheduled" — null when nothing scheduled is known. */
  scheduledLine: string | null;
  statusLabel: string;
}

/**
 * The status pill's colour. Separate from `statusLabel` because that string is
 * already localized — deriving a colour from it would mean matching English
 * literals, which is wrong the moment the app is in Spanish.
 */
export type WeekStatusTone = 'muted' | 'ochre' | 'green' | 'terracotta';

export interface NannyWeekWidgetProps extends WeekHoursBase {
  /** "38h submitted → 37h approved" when approval changed the total. Never money. */
  adjustmentNote: string | null;
  /** Mirrors `timesheet.status`; `muted` covers "not submitted yet". */
  tone: WeekStatusTone;
}

/** Parent side: hours + neutral status only. No approval nag, and NEVER money. */
export type ParentWeekWidgetProps = WeekHoursBase;

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

/**
 * Role-partitioned: a nanny gets real data in `nextShift` + `nannyWeek` and a
 * `WidgetRedirectProps` payload in the other two, a parent the mirror image. A
 * missing key means "nothing to say right now" — the apply layer LEAVES the
 * existing snapshot alone rather than clearing it, so a GC'd query cache never
 * blanks a correct widget.
 */
export interface WidgetSnapshotSet {
  nextShift?: WidgetPayload<NextShiftWidgetProps | WidgetRedirectProps>;
  todaysCover?: WidgetPayload<TodaysCoverWidgetProps | WidgetRedirectProps>;
  nannyWeek?: WidgetPayload<NannyWeekWidgetProps | WidgetRedirectProps>;
  parentWeek?: WidgetPayload<ParentWeekWidgetProps | WidgetRedirectProps>;
}

/**
 * The widget instances, registered by `src/widgets/` at import time via
 * `registerWidgetTargets`. Registration is inverted so this module never
 * imports the widget components (they pull in `@expo/ui/swift-ui`).
 */
export interface WidgetTargets {
  nextShift?: WidgetTarget<NextShiftWidgetProps>;
  todaysCover?: WidgetTarget<TodaysCoverWidgetProps>;
  nannyWeek?: WidgetTarget<NannyWeekWidgetProps>;
  parentWeek?: WidgetTarget<ParentWeekWidgetProps>;
}
