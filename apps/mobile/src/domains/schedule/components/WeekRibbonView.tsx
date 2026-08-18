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
  uncoveredByDay?: Record<string, readonly UncoveredWindow[]>
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
  if (uncoveredByDay) {
    for (const windows of Object.values(uncoveredByDay)) {
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
  /** Scrolls with the grid instead of sitting frozen above it. */
  listHeader?: ReactNode;
}

function cellStatusColour(
  shift: Shift | undefined,
  colors: ReturnType<typeof useThemeColors>
): string {
  if (!shift) {
    return colors.category.accent2;
  }
  if (shift.kind === SHIFT_KINDS.PARENT_COVER) {
    return colors.borderStrong;
  }
  switch (shift.status) {
    case 'confirmed':
    case 'completed':
      return colors.success;
    case 'pending':
    case 'draft':
      return colors.warning;
    case 'declined':
    case 'cancelled':
      // borderStrong, not gray200 — gray200 is the same hex as
      // themeColors.border, which paints empty cells, so a cancelled
      // (or parent-cover) block was invisible against the empty grid.
      return colors.borderStrong;
    default:
      return colors.category.accent2;
  }
}

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

export function WeekRibbonView({
  shifts,
  displayTimeZone,
  weekStartsOn = 1,
  timeOff = [],
  householdTimeZone = 'UTC',
  weekDates = [],
  uncoveredByDay,
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
    () => computeVisibleHours(shifts, displayTimeZone, uncoveredByDay),
    [shifts, displayTimeZone, uncoveredByDay]
  );

  const uncoveredCells = useMemo(() => {
    const cells = new Set<string>();
    if (!uncoveredByDay) return cells;
    for (const localDate of Object.keys(uncoveredByDay)) {
      const dow = localDateToWeekday(localDate);
      for (const window of uncoveredByDay[localDate] ?? []) {
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
  }, [uncoveredByDay, displayTimeZone]);

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
  const showUncoveredLegend =
    uncoveredByDay !== undefined &&
    Object.values(uncoveredByDay).some(windows => windows.length > 0);

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
            const shift = densestShift(shifts, dow, hour, displayTimeZone);
            const isUncovered = uncoveredCells.has(`${dow}-${hour}`);
            const filled = shift !== undefined;
            const colour = cellStatusColour(shift, themeColors);
            const isParentCover = shift?.kind === SHIFT_KINDS.PARENT_COVER;
            // Empty cells are a thin centred rule, not a full-height muted
            // capsule — the row's own `items-center` centres it — so an
            // occupied block is the only real shape on screen. An uncovered
            // cell wins over any shift and stays a non-navigating View.
            const cell = (
              <View
                testID={`week-ribbon-cell-${dow}-${hour}`}
                accessibilityState={{ selected: isUncovered || filled }}
                accessibilityLabel={
                  isUncovered
                    ? 'uncovered'
                    : isParentCover
                      ? 'parent_cover'
                      : (shift?.status ?? 'empty')
                }
                className="mx-0.5 flex-1 rounded-full"
                style={
                  isUncovered
                    ? {
                        height: 16,
                        backgroundColor: 'transparent',
                        borderWidth: 1.5,
                        borderColor: themeColors.destructive,
                      }
                    : {
                        height: filled ? 16 : 2,
                        backgroundColor: filled ? colour : themeColors.border,
                        opacity: 1,
                        borderWidth: 0,
                      }
                }
              />
            );
            if (isUncovered || !shift || isParentCover) {
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
      <View
        testID="week-ribbon-legend"
        className="flex-row flex-wrap items-center gap-4 pt-4"
      >
        <View className="flex-row items-center gap-2">
          <View
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: themeColors.success }}
          />
          <MetadataLabel className="text-muted-foreground">
            {t('shifts.statusConfirmed')}
          </MetadataLabel>
        </View>
        <View className="flex-row items-center gap-2">
          <View
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: themeColors.warning }}
          />
          <MetadataLabel className="text-muted-foreground">
            {t('shifts.statusPending')}
          </MetadataLabel>
        </View>
        <View className="flex-row items-center gap-2">
          <View
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: themeColors.borderStrong }}
          />
          <MetadataLabel className="text-muted-foreground">
            {t('shifts.statusCancelled')}
          </MetadataLabel>
        </View>
        {showUncoveredLegend ? (
          <View
            testID="week-ribbon-legend-uncovered"
            className="flex-row items-center gap-2"
          >
            <View
              className="h-3 w-3 rounded-full"
              style={{
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                borderColor: themeColors.destructive,
              }}
            />
            <MetadataLabel className="text-muted-foreground">
              {t('cover.rowPill')}
            </MetadataLabel>
          </View>
        ) : null}
        {showMultiCarerLegend ? (
          <MetadataLabel
            testID="week-ribbon-legend-multi-carer"
            className="text-muted-foreground"
          >
            {t('shifts.legendMultiCarer')}
          </MetadataLabel>
        ) : null}
      </View>
    </ScrollView>
  );
}
