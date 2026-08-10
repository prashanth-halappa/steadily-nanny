/**
 * @module domains/schedule/components/CrossFamilyRhythmView
 *
 * Calendar view 2d — a nanny with 2+ households' shifts in ONE table:
 * rows are dates, columns are AM/PM/Eve, dot colour is family identity.
 * Two tables per family forced her to cross-reference the same date twice
 * to answer "what am I doing on the 12th" — one table with both dots
 * showing side by side turns a clash into something she sees, not derives.
 *
 * PRIVACY: this legend shows REAL household names — deliberately, per the
 * user's ruling on TIER0-CX-SPEC.md §5.2. §5.2's "never a name" guarantee
 * protects the OTHER household FROM A PARENT, not from the nanny who works
 * for both and already knows both names; this screen is nanny-only
 * (`CalendarViewSwitcher`'s `nannyOnly`), so it was never the surface that
 * line was written to protect. `ScheduleShiftsScreen.tsx`'s `showCrossFamily`
 * additionally gates on `role === 'nanny'` so a parent can never reach this
 * component even via a stale/corrupted persisted view preference — belt and
 * braces, since the cost of a gate gap changed from "a parent sees an
 * anonymous grid" to "a parent sees another family's name" the moment this
 * screen started naming households.
 *
 * Shifts come from GET /me/shifts (one cross-household call) rather than
 * N parallel household range queries.
 */

import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import type { MeShift } from '@steadily-nanny/shared-types/schemas/me.schema';
import { COVERING_SHIFT_STATUSES } from '@steadily-nanny/shared-types/uncoveredCare';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE, useThemeColors } from '@/lib/design-tokens';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import {
  Caption,
  H4,
  MetadataLabel,
  Small,
} from '@/src/components/ui/typography';
import {
  type DayPeriod,
  shiftPeriod,
} from '@/src/domains/schedule/utils/shiftGrouping';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { useMeShifts } from '@/src/hooks/queries/useMeShifts';
import {
  addLocalDays,
  localDateInZone,
  localDateRange,
} from '@/src/lib/localDate';

const COVERING_STATUS_SET = new Set<string>(COVERING_SHIFT_STATUSES);

const PERIODS: DayPeriod[] = ['morning', 'afternoon', 'evening'];
const DAYS_IN_WINDOW = 14;
/** categoryAccent1 / accent2 / accent3, then every further household shares
 * the neutral fallback rather than inventing a 4th accent token. */
const MAX_DEDICATED_COLOURS = 3;

export interface RhythmWorkSlot {
  householdId: string;
  date: string;
  period: DayPeriod;
}

/** date|period -> the set of households working that slot. */
export function buildSlotIndex(
  slots: readonly RhythmWorkSlot[]
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const { householdId, date, period } of slots) {
    const key = `${date}|${period}`;
    const set = index.get(key) ?? new Set<string>();
    set.add(householdId);
    index.set(key, set);
  }
  return index;
}

export function isFilledSlot(
  index: Map<string, Set<string>>,
  householdId: string,
  date: string,
  period: DayPeriod
): boolean {
  return index.get(`${date}|${period}`)?.has(householdId) ?? false;
}

/** Two+ households wanting the exact same date+period — the one thing on
 * the screen that needs her attention. */
export function isClashSlot(
  index: Map<string, Set<string>>,
  date: string,
  period: DayPeriod
): boolean {
  return (index.get(`${date}|${period}`)?.size ?? 0) >= 2;
}

/** Distinct DATES a household works in the window — not slot count, so two
 * periods on the same day still reads as "1 day". */
export function countWorkingDays(
  index: Map<string, Set<string>>,
  householdId: string,
  dates: readonly string[]
): number {
  return dates.filter(date =>
    PERIODS.some(period => isFilledSlot(index, householdId, date, period))
  ).length;
}

/** Distinct DATES with a clash anywhere in the day, deduped across periods. */
export function countClashDays(
  index: Map<string, Set<string>>,
  dates: readonly string[]
): number {
  return dates.filter(date =>
    PERIODS.some(period => isClashSlot(index, date, period))
  ).length;
}

/** Shifts -> work slots. Only COVERING_SHIFT_STATUSES count: a cancelled,
 * declined or draft shift is not real cover for either family and must not
 * count toward the headline numbers or paint a dot. This used to exclude only
 * `cancelled`, so a shift the carer had DECLINED still painted a dot and
 * inflated the clash count. */
export function slotsFromShifts(
  shifts: readonly MeShift[],
  timeZoneFor: (householdId: string) => string
): RhythmWorkSlot[] {
  const slots: RhythmWorkSlot[] = [];
  for (const shift of shifts) {
    if (!COVERING_STATUS_SET.has(shift.status)) continue;
    slots.push({
      householdId: shift.household_id,
      date: shift.local_date,
      period: shiftPeriod(shift, timeZoneFor(shift.household_id)),
    });
  }
  return slots;
}

/** Stable dot colour SLOT for a household, by its position in the caller's
 * own household order — 0/1/2 get their own accent, everything from the
 * 4th household on shares index 3 (the neutral fallback) instead of
 * throwing or inventing a 4th accent token. */
export function householdColourIndex(
  householdIds: readonly string[],
  householdId: string
): number {
  const i = householdIds.indexOf(householdId);
  return i === -1 ? 0 : Math.min(i, MAX_DEDICATED_COLOURS);
}

interface CrossFamilyRhythmViewProps {
  households: Household[];
  activeHouseholdId: string;
}

export function CrossFamilyRhythmView({
  households,
  activeHouseholdId,
}: CrossFamilyRhythmViewProps) {
  const { t } = useTranslation('schedule');
  const colors = useThemeColors();
  // Same tab-bar dead-zone fix as Settings (BUG1) — this is one of the
  // Schedule tab's own scrollable views, so it needs the same real
  // clearance a fixed magic number can't give.
  const tabBarScrollPadding = useTabBarScrollPadding();
  const activeHousehold = households.find(h => h.id === activeHouseholdId);
  const timeZone = activeHousehold?.timezone ?? 'UTC';
  const startDate = localDateInZone(timeZone);
  const dates = localDateRange(startDate, DAYS_IN_WINDOW);

  // Fetch EXACTLY the window we render. Deriving [from, to) from `dates`
  // itself makes the query and the table impossible to drift apart. The
  // one-day pad on each side absorbs the UTC/local offset.
  const rangeStart = dates[0] ?? startDate;
  const rangeEnd = dates[dates.length - 1] ?? startDate;
  const from = `${addLocalDays(rangeStart, -1)}T00:00:00.000Z`;
  const to = `${addLocalDays(rangeEnd, 2)}T00:00:00.000Z`;

  const meShifts = useMeShifts(from, to);

  const timeZoneFor = (householdId: string): string =>
    households.find(h => h.id === householdId)?.timezone ?? timeZone;
  const slots = slotsFromShifts(meShifts.data ?? [], timeZoneFor);
  const index = buildSlotIndex(slots);

  // Which household is the switcher's current selection — used for the
  // working-days summary copy ("this family"/"the other family") and the
  // dot colour order. The legend itself names every household by `h.name`
  // (this screen is nanny-only, see module doc).
  const isActive = (householdId: string) => householdId === activeHouseholdId;
  const householdIds = households.map(h => h.id);
  const dotColours = [
    colors.category.accent1,
    colors.category.accent2,
    colors.category.accent3,
    colors.neutral,
  ];
  const colourFor = (householdId: string): string =>
    dotColours[householdColourIndex(householdIds, householdId)] ??
    colors.neutral;
  // Legend chip ground — same accent, paired `chipCat*` token (neutral
  // fallback shares `chipPlum`, the system's other neutral chip ground).
  const chipColours = [
    colors.chip.cat1,
    colors.chip.cat2,
    colors.chip.cat3,
    colors.chip.plum,
  ];
  const chipColourFor = (householdId: string): string =>
    chipColours[householdColourIndex(householdIds, householdId)] ??
    colors.chip.plum;

  const clashDays = countClashDays(index, dates);

  return (
    <ScrollView
      testID="calendar-cross-family-view"
      className="flex-1"
      contentContainerStyle={{
        paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
        paddingBottom: tabBarScrollPadding,
      }}
    >
      <MetadataLabel className="mb-1 text-muted-foreground">
        {t('crossFamily.header')}
      </MetadataLabel>
      {/* The answer before the evidence. */}
      <H4 testID="cross-family-clash-summary" className="mb-1">
        {clashDays === 0
          ? t('crossFamily.noClashes')
          : t('crossFamily.clashCount', { count: clashDays })}
      </H4>
      {households.map(h => (
        <Small
          key={h.id}
          testID={`cross-family-working-days-${h.id}`}
          className="text-muted-foreground"
        >
          {isActive(h.id)
            ? t('crossFamily.workingDaysThisFamily', {
                count: countWorkingDays(index, h.id, dates),
              })
            : t('crossFamily.workingDaysOtherFamily', {
                count: countWorkingDays(index, h.id, dates),
              })}
        </Small>
      ))}

      {/* One table. Rows = dates, columns = AM/PM/Eve — a clash is two
          dots sitting in the same cell, not something she has to derive
          from two separate lists. */}
      <View className="mt-4 flex-row items-center gap-2">
        <View className="w-14" />
        <View className="flex-1 flex-row">
          {PERIODS.map(period => (
            <View key={period} className="flex-1 items-center">
              <MetadataLabel className="text-muted-foreground">
                {t(`period.${period}`)}
              </MetadataLabel>
            </View>
          ))}
        </View>
      </View>
      {dates.map(date => (
        <View
          key={date}
          testID={`cross-family-row-${date}`}
          className="mb-1.5 flex-row items-center gap-2"
        >
          <Small tabular className="w-14 text-muted-foreground">
            {formatDisplayDate(date)}
          </Small>
          <View className="flex-1 flex-row">
            {PERIODS.map(period => {
              const occupants = households.filter(h =>
                isFilledSlot(index, h.id, date, period)
              );
              return (
                <View
                  key={period}
                  testID={`cross-family-cell-${date}-${period}`}
                  className="flex-1 flex-row items-center justify-center gap-0.5"
                >
                  {occupants.length === 0 ? (
                    <View
                      className="h-1 w-1 rounded-full"
                      style={{ backgroundColor: colors.border }}
                    />
                  ) : (
                    occupants.map(h => (
                      <View
                        key={h.id}
                        testID={`cross-family-dot-${date}-${period}-${h.id}`}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: colourFor(h.id) }}
                      />
                    ))
                  )}
                </View>
              );
            })}
          </View>
        </View>
      ))}

      {/* One legend, once, directly under the table it explains — colour
          maps to family here, never to a household's real name. */}
      <View
        testID="cross-family-legend"
        className="mt-3 flex-row flex-wrap items-center gap-3"
      >
        {households.map(h => (
          <View
            key={h.id}
            testID={`cross-family-legend-${h.id}`}
            className="flex-row items-center gap-2"
          >
            <View
              className="h-6 w-6 items-center justify-center rounded-cell"
              style={{ backgroundColor: chipColourFor(h.id) }}
            >
              <View
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: colourFor(h.id) }}
              />
            </View>
            {/* Real household name — nanny-only surface, see module doc. */}
            <Caption className="text-muted-foreground">{h.name}</Caption>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
