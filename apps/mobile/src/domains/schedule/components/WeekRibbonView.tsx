/**
 * @module domains/schedule/components/WeekRibbonView
 *
 * Calendar week ribbon — bounded working-hour grid with short weekday headers
 * (Daylight UX #13: do not paint Pending as Confirmed green). Occupied cells
 * open shift detail so a Week preference is not a read-only dead end.
 * Away days (carer time off) are marked on the weekday header.
 */
import type { CarerTimeOff } from '@steadily-nanny/shared-types/schemas/availability.schema';
import {
  SHIFT_KINDS,
  type Shift,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { UncoveredWindow } from '@steadily-nanny/shared-types/uncoveredCare';
import { type Href, useRouter } from 'expo-router';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE, useThemeColors } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { Label, MetadataLabel, Small } from '@/src/components/ui/typography';
import {
  hourCellOccupied,
  localDateToWeekday,
  minutesInZone,
  RESOLVED_STATUSES,
} from '@/src/domains/schedule/utils/shiftGrouping';
import { timeOffCoversLocalDate } from '@/src/domains/schedule/utils/timeOffOverlap';
import { getWeekdayOrder } from '@/src/lib/weekdayOrder';

/** First hour row shown when no shifts fall earlier (typical day start). */
const WEEK_RIBBON_DEFAULT_START_HOUR = 6;
/** Last hour row shown when no shifts fall later (inclusive). */
const WEEK_RIBBON_DEFAULT_END_HOUR = 20;
/** Extra hour rows above/below occupied cells so edge shifts stay visible. */
const WEEK_RIBBON_HOUR_PADDING = 1;

function computeVisibleHours(
  shifts: Shift[],
  displayTimeZone?: string | null,
  uncoveredByDay?: Record<string, readonly UncoveredWindow[]>,
  awaitingByDay?: Record<string, readonly UncoveredWindow[]>
): number[] {
  let start = WEEK_RIBBON_DEFAULT_START_HOUR;
  let end = WEEK_RIBBON_DEFAULT_END_HOUR;

  const expandFor = (startsAt: string, endsAt: string) => {
    const startMin = minutesInZone(startsAt, displayTimeZone);
    const endMin = minutesInZone(endsAt, displayTimeZone);
    for (let hour = 0; hour < 24; hour++) {
      if (hourCellOccupied(startMin, endMin, hour)) {
        start = Math.min(start, hour);
        end = Math.max(end, hour);
      }
    }
  };

  for (const shift of shifts) {
    expandFor(shift.starts_at, shift.ends_at);
  }
  for (const byDay of [uncoveredByDay, awaitingByDay]) {
    for (const windows of Object.values(byDay ?? {})) {
      for (const window of windows) {
        expandFor(window.startsAt, window.endsAt);
      }
    }
  }

  start = Math.max(0, start - WEEK_RIBBON_HOUR_PADDING);
  end = Math.min(23, end + WEEK_RIBBON_HOUR_PADDING);

  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

interface WeekRibbonViewProps {
  shifts: Shift[];
  displayTimeZone?: string | null;
  weekStartsOn?: number | null;
  timeOff?: CarerTimeOff[];
  householdTimeZone?: string;
  weekDates?: string[];
  uncoveredByDay?: Record<string, readonly UncoveredWindow[]>;
  /** Slices of uncovered care a pending pattern covers — drawn in the
   * pending style; an uncovered cell still wins. */
  awaitingByDay?: Record<string, readonly UncoveredWindow[]>;
  /** Scrolls with the grid instead of sitting frozen above it. */
  listHeader?: ReactNode;
}

type CellKind =
  | 'uncovered'
  | 'pending'
  | 'confirmed'
  | 'parentCover'
  | 'cancelled'
  | 'empty';

function cellKind(
  shift: Shift | undefined,
  isUncovered: boolean,
  isAwaiting: boolean
): CellKind {
  // Uncovered wins over any shift, so a visible cancelled bar always means
  // "nothing needed here now".
  if (isUncovered) return 'uncovered';
  if (!shift) return isAwaiting ? 'pending' : 'empty';
  if (shift.kind === SHIFT_KINDS.PARENT_COVER) return 'parentCover';
  switch (shift.status) {
    case 'confirmed':
    case 'completed':
      return 'confirmed';
    case 'pending':
    case 'draft':
      return 'pending';
    default:
      // declined | cancelled — every other ShiftStatus is handled above.
      return 'cancelled';
  }
}

/**
 * The one source of truth for a cell's look; the legend draws its swatches
 * from this too, so grid and legend cannot drift. Shape (fill / dashed
 * outline / outline-on-wash / half bar / rule) and hue each carry the state —
 * no two states share both. Solid amber = you need to act; hollow dashed
 * amber = asked, waiting on the nanny (dashed = waiting, as `Card
 * provisional`). Inline style only (GOLDEN-FIXES #2).
 */
function cellStyle(kind: CellKind, colors: ReturnType<typeof useThemeColors>) {
  const none = { borderWidth: 0, borderStyle: 'solid' as const };
  switch (kind) {
    case 'uncovered':
      // warningStrong: plain `warning` is only 2.7:1 on the ground.
      return {
        height: 16,
        backgroundColor: colors.warningStrong,
        ...none,
        borderColor: 'transparent',
      };
    case 'pending':
      return {
        height: 16,
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderStyle: 'dashed' as const,
        borderColor: colors.warningStrong,
      };
    case 'confirmed':
      return {
        height: 16,
        backgroundColor: colors.primary,
        ...none,
        borderColor: 'transparent',
      };
    case 'parentCover':
      // Household hue, hollow-ish: covered, but not a booking.
      return {
        height: 16,
        backgroundColor: colors.washPlum,
        borderWidth: 1.5,
        borderStyle: 'solid' as const,
        borderColor: colors.primary,
      };
    case 'cancelled':
      // History, so it recedes — but still 3:1+ and never the 2px empty rule.
      return {
        height: 8,
        backgroundColor: colors.gray[500],
        ...none,
        borderColor: 'transparent',
      };
    case 'empty':
      return {
        height: 2,
        backgroundColor: colors.border,
        ...none,
        borderColor: 'transparent',
      };
  }
}

type SegmentKind = Exclude<CellKind, 'cancelled'>;
interface Segment {
  kind: SegmentKind;
  minutes: number;
}
interface MinuteSource {
  startMin: number;
  endMin: number;
  kind: SegmentKind;
  shift?: Shift;
}
/** Precedence where sources overlap within the same minutes (addendum A2). */
const SEGMENT_RANK: Record<SegmentKind, number> = {
  empty: 0,
  parentCover: 1,
  confirmed: 2,
  pending: 3,
  uncovered: 4,
};
/** Unoccupied minutes inside a split hour: no fill, no rule. */
const EMPTY_SEGMENT_STYLE = {
  height: 16,
  backgroundColor: 'transparent',
  borderWidth: 0,
};

/** Does `[startMin, endMin)` (wrapping past midnight, as `hourCellOccupied`) hold minute `t`? */
function rangeHolds(startMin: number, endMin: number, t: number): boolean {
  return endMin > startMin
    ? t >= startMin && t < endMin
    : t >= startMin || t < endMin;
}

/**
 * The hour's minutes as time-ordered, merged `{ kind, minutes }` runs.
 * Cancelled sources are never passed in, so they count as empty here.
 */
function hourSegments(sources: readonly MinuteSource[], hour: number) {
  const segments: Segment[] = [];
  for (let m = 0; m < 60; m++) {
    let kind: SegmentKind = 'empty';
    for (const source of sources) {
      if (
        SEGMENT_RANK[source.kind] > SEGMENT_RANK[kind] &&
        rangeHolds(source.startMin, source.endMin, hour * 60 + m)
      ) {
        kind = source.kind;
      }
    }
    const last = segments[segments.length - 1];
    if (last?.kind === kind) last.minutes++;
    else segments.push({ kind, minutes: 1 });
  }
  return segments;
}

/** Legend order is by consequence; empty gets no item (a hairline explains itself). */
const LEGEND_ITEMS: ReadonlyArray<{
  kind: Exclude<CellKind, 'empty'>;
  testID: string;
  labelKey: string;
}> = [
  {
    kind: 'uncovered',
    testID: 'week-ribbon-legend-uncovered',
    labelKey: 'cover.rowPill',
  },
  {
    kind: 'pending',
    testID: 'week-ribbon-legend-pending',
    labelKey: 'shifts.statusPending',
  },
  {
    kind: 'confirmed',
    testID: 'week-ribbon-legend-confirmed',
    labelKey: 'shifts.statusConfirmed',
  },
  {
    kind: 'parentCover',
    testID: 'week-ribbon-legend-parent-cover',
    labelKey: 'cover.parentCoveringRow',
  },
  {
    kind: 'cancelled',
    testID: 'week-ribbon-legend-cancelled',
    labelKey: 'shifts.statusCancelled',
  },
];

function densestShift(
  shifts: Shift[],
  dow: number,
  hour: number,
  displayTimeZone?: string | null
): Shift | undefined {
  const occupying = shifts.filter(s => {
    const sDow = localDateToWeekday(s.local_date);
    if (sDow !== dow) return false;
    return hourCellOccupied(
      minutesInZone(s.starts_at, displayTimeZone),
      minutesInZone(s.ends_at, displayTimeZone),
      hour
    );
  });
  if (occupying.length === 0) return undefined;
  // Prefer pending over confirmed so a mixed cell does not lie as Confirmed.
  const pending = occupying.find(
    s => s.status === 'pending' || s.status === 'draft'
  );
  // After pending/draft, prefer a live shift so a cancelled twin never
  // beats its confirmed replacement at the same starts_at.
  return (
    pending ??
    occupying.find(s => !RESOLVED_STATUSES.has(s.status)) ??
    occupying[0]
  );
}

/** `${dow}-${hour}` keys of every hour cell a window touches. */
function windowCells(
  byDay: Record<string, readonly UncoveredWindow[]> | undefined,
  displayTimeZone?: string | null
): Set<string> {
  const cells = new Set<string>();
  if (!byDay) return cells;
  for (const localDate of Object.keys(byDay)) {
    const dow = localDateToWeekday(localDate);
    for (const window of byDay[localDate] ?? []) {
      const startMin = minutesInZone(window.startsAt, displayTimeZone);
      const endMin = minutesInZone(window.endsAt, displayTimeZone);
      for (let hour = 0; hour < 24; hour++) {
        if (hourCellOccupied(startMin, endMin, hour)) {
          cells.add(`${dow}-${hour}`);
        }
      }
    }
  }
  return cells;
}

export function WeekRibbonView({
  shifts,
  displayTimeZone,
  weekStartsOn = 1,
  timeOff = [],
  householdTimeZone = 'UTC',
  weekDates = [],
  uncoveredByDay,
  awaitingByDay,
  listHeader,
}: WeekRibbonViewProps) {
  const { t } = useTranslation('schedule');
  const themeColors = useThemeColors();
  const router = useRouter();
  // Same tab-bar dead-zone fix as Settings (BUG1) — this is one of the
  // Schedule tab's own scrollable views, so it needs the same real
  // clearance a fixed magic number can't give.
  const tabBarScrollPadding = useTabBarScrollPadding();
  const { refreshControl } = usePullToRefresh();
  const displayOrder = getWeekdayOrder(weekStartsOn);

  const visibleHours = useMemo(
    () =>
      computeVisibleHours(
        shifts,
        displayTimeZone,
        uncoveredByDay,
        awaitingByDay
      ),
    [shifts, displayTimeZone, uncoveredByDay, awaitingByDay]
  );

  const uncoveredCells = useMemo(
    () => windowCells(uncoveredByDay, displayTimeZone),
    [uncoveredByDay, displayTimeZone]
  );
  const awaitingCells = useMemo(
    () => windowCells(awaitingByDay, displayTimeZone),
    [awaitingByDay, displayTimeZone]
  );

  const awayByDow = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const localDate of weekDates) {
      const dow = localDateToWeekday(localDate);
      const away = timeOff.some(row =>
        timeOffCoversLocalDate(row, localDate, householdTimeZone)
      );
      if (away) map.set(dow, true);
    }
    return map;
  }, [weekDates, timeOff, householdTimeZone]);

  // A colour-only legend can't tell a parent "which block is whose" once
  // more than one carer is on the calendar — the 4th legend item only earns
  // its place then.
  const showMultiCarerLegend =
    new Set(
      shifts.map(s => s.carer_id).filter((id): id is string => Boolean(id))
    ).size >= 2;
  // One pass resolves every visible cell; the legend shows only the kinds
  // that actually appear, so it never explains a state that isn't on screen.
  const grid = useMemo(() => {
    const cells = new Map<
      string,
      { kind: CellKind; shift?: Shift; segments?: Segment[] }
    >();
    const present = new Set<CellKind>();
    // Minute ranges per weekday, for hours that are themselves partial.
    const sourcesByDow = new Map<number, MinuteSource[]>();
    const addSource = (localDate: string, source: MinuteSource) => {
      const dow = localDateToWeekday(localDate);
      const list = sourcesByDow.get(dow) ?? [];
      list.push(source);
      sourcesByDow.set(dow, list);
    };
    for (const [byDay, kind] of [
      [uncoveredByDay, 'uncovered'],
      [awaitingByDay, 'pending'],
    ] as const) {
      for (const [localDate, windows] of Object.entries(byDay ?? {})) {
        for (const window of windows) {
          addSource(localDate, {
            startMin: minutesInZone(window.startsAt, displayTimeZone),
            endMin: minutesInZone(window.endsAt, displayTimeZone),
            kind,
          });
        }
      }
    }
    for (const shift of shifts) {
      const kind = cellKind(shift, false, false);
      if (kind === 'cancelled') continue;
      addSource(shift.local_date, {
        startMin: minutesInZone(shift.starts_at, displayTimeZone),
        endMin: minutesInZone(shift.ends_at, displayTimeZone),
        kind,
        shift,
      });
    }
    for (const hour of visibleHours) {
      for (const dow of displayOrder) {
        const key = `${dow}-${hour}`;
        const sources = sourcesByDow.get(dow) ?? [];
        const segments = hourSegments(sources, hour);
        const kinds = new Set(
          segments.map(s => s.kind).filter(k => k !== 'empty')
        );
        if (kinds.size >= 2) {
          // Routable only when exactly one shift is in the hour; a
          // parent-cover cell is never routable, split or not.
          const inHour = sources.filter(
            s => s.shift && hourCellOccupied(s.startMin, s.endMin, hour)
          );
          const only = inHour.length === 1 ? inHour[0] : undefined;
          const shift = only?.kind === 'parentCover' ? undefined : only?.shift;
          const [first] = kinds;
          cells.set(key, { kind: first ?? 'empty', shift, segments });
          for (const k of kinds) present.add(k);
          continue;
        }
        const shift = densestShift(shifts, dow, hour, displayTimeZone);
        // Asked, not yet answered (a pending pattern materialises no shifts).
        const kind = cellKind(
          shift,
          uncoveredCells.has(key),
          awaitingCells.has(key)
        );
        cells.set(key, { kind, shift });
        present.add(kind);
      }
    }
    return { cells, present };
  }, [
    visibleHours,
    displayOrder,
    shifts,
    displayTimeZone,
    uncoveredCells,
    awaitingCells,
    uncoveredByDay,
    awaitingByDay,
  ]);

  return (
    <ScrollView
      testID="calendar-week-ribbon-view"
      refreshControl={refreshControl}
      className="flex-1"
      contentContainerStyle={{
        paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
        paddingBottom: tabBarScrollPadding,
      }}
    >
      {listHeader}
      {/* Above the grid, not below — on a full 15-row week the legend never
          scrolled into view sitting after every hour row. */}
      <View
        testID="week-ribbon-legend"
        className="flex-row flex-wrap items-center gap-4 pb-4"
      >
        {LEGEND_ITEMS.filter(item => grid.present.has(item.kind)).map(item => {
          const style = cellStyle(item.kind, themeColors);
          return (
            <View
              key={item.kind}
              testID={item.testID}
              className="flex-row items-center gap-2"
            >
              {/* A mini cell, not a dot — a dot can't show "hollow dashed"
                    or "half-height". */}
              <View
                testID={`${item.testID}-swatch`}
                className="rounded-full"
                style={{
                  ...style,
                  width: 20,
                  height: item.kind === 'cancelled' ? 5 : 10,
                  borderWidth: style.borderWidth ? 1 : 0,
                }}
              />
              <MetadataLabel className="text-muted-foreground">
                {t(item.labelKey)}
              </MetadataLabel>
            </View>
          );
        })}
        {showMultiCarerLegend ? (
          <MetadataLabel
            testID="week-ribbon-legend-multi-carer"
            className="text-muted-foreground"
          >
            {t('shifts.legendMultiCarer')}
          </MetadataLabel>
        ) : null}
      </View>
      <View className="flex-row pb-2">
        <View className="w-12 items-end pr-2">
          <MetadataLabel className="text-muted-foreground">
            {t('shifts.axisTime')}
          </MetadataLabel>
        </View>
        {displayOrder.map(dow => (
          <View key={dow} className="flex-1 items-center">
            {/* Short form ("Mon") — seven full weekday names ("Monday")
                don't fit this column width and wrap mid-word ("Monda / y")
                even on the widest phones. */}
            <Label weight="medium" numberOfLines={1}>
              {t(`weekdayShort.${dow}`)}
            </Label>
            {awayByDow.get(dow) ? (
              <Small
                testID={`week-ribbon-away-${dow}`}
                className="text-muted-foreground"
              >
                {t('shifts.awayBand')}
              </Small>
            ) : null}
          </View>
        ))}
      </View>
      {visibleHours.map(hour => (
        <View key={hour} className="flex-row items-center py-0.5">
          <View className="w-12 items-end pr-2">
            <MetadataLabel className="text-muted-foreground" tabular>
              {`${String(hour).padStart(2, '0')}:00`}
            </MetadataLabel>
          </View>
          {displayOrder.map(dow => {
            const { kind, shift, segments } = grid.cells.get(
              `${dow}-${hour}`
            ) ?? { kind: 'empty' as const };
            const isUncovered = kind === 'uncovered';
            const isParentCover = kind === 'parentCover';
            // No flex-1 here: its flexBasis would fight the per-state height.
            // The wrapper is flex-1 in the row and stretches this across.
            const cell = segments ? (
              <View
                testID={`week-ribbon-cell-${dow}-${hour}`}
                accessibilityState={{ selected: true }}
                accessibilityLabel={segments
                  .filter(s => s.kind !== 'empty')
                  .map(s => s.kind)
                  .join('+')}
                className="mx-0.5"
                style={{ flexDirection: 'row', gap: 1, height: 16 }}
              >
                {segments.map((s, i) => (
                  <View
                    // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional within a fixed hour
                    key={i}
                    testID={`week-ribbon-cell-${dow}-${hour}-seg-${i}`}
                    style={{
                      ...(s.kind === 'empty'
                        ? EMPTY_SEGMENT_STYLE
                        : cellStyle(s.kind, themeColors)),
                      flex: s.minutes,
                      minWidth: 6,
                      borderRadius: 8,
                    }}
                  />
                ))}
              </View>
            ) : (
              <View
                testID={`week-ribbon-cell-${dow}-${hour}`}
                accessibilityState={{ selected: kind !== 'empty' }}
                accessibilityLabel={
                  isUncovered
                    ? 'uncovered'
                    : isParentCover
                      ? 'parent_cover'
                      : (shift?.status ?? kind)
                }
                className="mx-0.5 rounded-full"
                style={cellStyle(kind, themeColors)}
              />
            );
            // A split cell carries a shift only when it is routable.
            if (!shift || (!segments && (isUncovered || isParentCover))) {
              return (
                <View key={`${dow}-${hour}`} className="flex-1">
                  {cell}
                </View>
              );
            }
            return (
              <Pressable
                key={`${dow}-${hour}`}
                testID={`week-ribbon-press-${dow}-${hour}`}
                accessibilityRole="button"
                className="flex-1"
                onPress={() =>
                  router.push(`/(private)/schedule/shifts/${shift.id}` as Href)
                }
              >
                {cell}
              </Pressable>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}
