/**
 * @module domains/schedule/components/CrossFamilyRhythmView
 *
 * Calendar view 2d — 14-day morning/afternoon/evening dots for a nanny
 * with 2+ households. Non-active households are ALWAYS labelled "Other
 * family" — household.name must never appear in the UI for them.
 *
 * Shifts come from GET /me/shifts (one cross-household call) rather than
 * N parallel household range queries.
 */

import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import type { MeShift } from '@steadily-nanny/shared-types/schemas/me.schema';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE, useThemeColors } from '@/lib/design-tokens';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { Caption, H3, Small } from '@/src/components/ui/typography';
import {
  type DayPeriod,
  shiftPeriod,
} from '@/src/domains/schedule/utils/shiftGrouping';
import { useMeShifts } from '@/src/hooks/queries/useMeShifts';
import {
  addLocalDays,
  localDateInZone,
  localDateRange,
} from '@/src/lib/localDate';

const PERIODS: DayPeriod[] = ['morning', 'afternoon', 'evening'];

interface CrossFamilyRhythmViewProps {
  households: Household[];
  activeHouseholdId: string;
}

function PeriodDot({ filled, testID }: { filled: boolean; testID: string }) {
  const themeColors = useThemeColors();
  return (
    <View
      testID={testID}
      className="mx-0.5 h-3 w-3 rounded-full"
      style={{
        backgroundColor: filled
          ? themeColors.category.accent2
          : themeColors.border,
      }}
    />
  );
}

export function CrossFamilyRhythmView({
  households,
  activeHouseholdId,
}: CrossFamilyRhythmViewProps) {
  const { t } = useTranslation('schedule');
  // Same tab-bar dead-zone fix as Settings (BUG1) — this is one of the
  // Schedule tab's own scrollable views, so it needs the same real
  // clearance a fixed magic number can't give.
  const tabBarScrollPadding = useTabBarScrollPadding();
  const activeHousehold = households.find(h => h.id === activeHouseholdId);
  const timeZone = activeHousehold?.timezone ?? 'UTC';
  const startDate = localDateInZone(timeZone);
  const dates = localDateRange(startDate, 14);

  // Fetch EXACTLY the window we render. Deriving [from, to) from `dates`
  // itself makes the query and the grid impossible to drift apart. The
  // one-day pad on each side absorbs the UTC/local offset.
  const rangeStart = dates[0] ?? startDate;
  const rangeEnd = dates[13] ?? startDate;
  const from = `${addLocalDays(rangeStart, -1)}T00:00:00.000Z`;
  const to = `${addLocalDays(rangeEnd, 2)}T00:00:00.000Z`;

  const meShifts = useMeShifts(from, to);

  const shiftsByHousehold = new Map<string, MeShift[]>();
  for (const h of households) {
    shiftsByHousehold.set(h.id, []);
  }
  for (const shift of meShifts.data ?? []) {
    const list = shiftsByHousehold.get(shift.household_id);
    if (list) list.push(shift);
  }

  const isActive = (householdId: string) => householdId === activeHouseholdId;

  const labelFor = (householdId: string): string => {
    if (isActive(householdId)) {
      return t('crossFamily.thisFamily');
    }
    // Deliberately never use household.name for non-active families.
    return t('crossFamily.otherFamily');
  };

  const hasShiftInPeriod = (
    householdId: string,
    localDate: string,
    period: DayPeriod
  ): boolean => {
    const tz = households.find(h => h.id === householdId)?.timezone ?? timeZone;
    const shifts = shiftsByHousehold.get(householdId) ?? [];
    return shifts.some(
      s =>
        s.local_date === localDate &&
        shiftPeriod(s, tz) === period &&
        s.status !== 'cancelled'
    );
  };

  return (
    <ScrollView
      testID="calendar-cross-family-view"
      className="flex-1"
      contentContainerStyle={{
        paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
        paddingBottom: tabBarScrollPadding,
      }}
    >
      <Small className="mb-3 text-muted-foreground">
        {t('crossFamily.header')}
      </Small>
      {households.map(h => (
        <View
          key={h.id}
          testID={`cross-family-row-${h.id}`}
          className="mb-4 rounded-lg bg-muted p-3"
        >
          <H3 testID={`cross-family-label-${h.id}`} className="mb-2">
            {labelFor(h.id)}
          </H3>
          {dates.map(date => (
            <View
              key={`${h.id}-${date}`}
              testID={`cross-family-day-${h.id}-${date}`}
              className="mb-1 flex-row items-center gap-2"
            >
              <Caption className="w-16 text-muted-foreground" tabular>
                {date.slice(5)}
              </Caption>
              <View className="flex-row">
                {PERIODS.map(period => (
                  <PeriodDot
                    key={period}
                    filled={hasShiftInPeriod(h.id, date, period)}
                    testID={`cross-family-dot-${h.id}-${date}-${period}`}
                  />
                ))}
              </View>
              <Caption className="text-muted-foreground">
                {PERIODS.map(period => t(`period.${period}`)).join('/')}
              </Caption>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
