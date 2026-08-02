/**
 * @module domains/schedule/components/CrossFamilyRhythmView
 *
 * Calendar view 2d — 14-day morning/afternoon/evening dots for a nanny
 * with 2+ households. Non-active households are ALWAYS labelled "Other
 * family" — household.name must never appear in the UI for them.
 */

import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useQueries } from '@tanstack/react-query';
import { ScrollView, View } from 'react-native';
import { shiftApi } from '@/src/api/endpoints/shifts';
import { queryKeys } from '@/src/api/queryKeys';
import { Body, H3 } from '@/src/components/ui/typography';
import {
  type DayPeriod,
  OTHER_FAMILY_LABEL,
  shiftPeriod,
} from '@/src/domains/schedule/utils/shiftGrouping';
import {
  addLocalDays,
  localDateInZone,
  localDateRange,
} from '@/src/lib/localDate';

const PERIODS: DayPeriod[] = ['morning', 'afternoon', 'evening'];
const PERIOD_LABELS: Record<DayPeriod, string> = {
  morning: 'AM',
  afternoon: 'PM',
  evening: 'Eve',
};

interface CrossFamilyRhythmViewProps {
  households: Household[];
  activeHouseholdId: string;
}

function periodDot(filled: boolean, testID: string) {
  return (
    <View
      testID={testID}
      className="mx-0.5 h-3 w-3 rounded-full"
      style={{
        backgroundColor: filled ? '#14B8A6' : '#E5E7EB',
      }}
    />
  );
}

export function CrossFamilyRhythmView({
  households,
  activeHouseholdId,
}: CrossFamilyRhythmViewProps) {
  const activeHousehold = households.find(h => h.id === activeHouseholdId);
  const timeZone = activeHousehold?.timezone ?? 'UTC';
  const startDate = localDateInZone(timeZone);
  const dates = localDateRange(startDate, 14);

  // Fetch EXACTLY the window we render. `twoWeekRange()` anchored the query
  // to the most recent Monday while the grid always starts at *today* in the
  // household's zone, so up to six of the fourteen rendered days were never
  // fetched at all and their dots read as "no shifts". Deriving [from, to)
  // from `dates` itself makes the two impossible to drift apart. The one-day
  // pad on each side absorbs the UTC/local offset (the render filter is an
  // exact `s.local_date === date` match, so extra rows are inert).
  const rangeStart = dates[0] ?? startDate;
  const rangeEnd = dates[13] ?? startDate;
  const from = `${addLocalDays(rangeStart, -1)}T00:00:00.000Z`;
  const to = `${addLocalDays(rangeEnd, 2)}T00:00:00.000Z`;

  const shiftQueries = useQueries({
    queries: households.map(h => ({
      queryKey: queryKeys.shift.range(h.id, from, to),
      queryFn: () => shiftApi.range(h.id, from, to),
      staleTime: 60_000,
    })),
  });

  const shiftsByHousehold = new Map<string, Shift[]>();
  households.forEach((h, i) => {
    shiftsByHousehold.set(h.id, shiftQueries[i]?.data ?? []);
  });

  const isActive = (householdId: string) => householdId === activeHouseholdId;

  const labelFor = (householdId: string): string => {
    if (isActive(householdId)) {
      return 'This family';
    }
    // Deliberately never use household.name for non-active families.
    return OTHER_FAMILY_LABEL;
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
    <ScrollView testID="calendar-cross-family-view" className="flex-1 px-4">
      <Body className="mb-3 text-sm text-muted-foreground">
        Two-week rhythm across your families
      </Body>
      {households.map(h => (
        <View
          key={h.id}
          testID={`cross-family-row-${h.id}`}
          className="mb-4 rounded-lg bg-muted p-3"
        >
          <H3 testID={`cross-family-label-${h.id}`} className="mb-2 text-base">
            {labelFor(h.id)}
          </H3>
          {dates.map(date => (
            <View
              key={`${h.id}-${date}`}
              testID={`cross-family-day-${h.id}-${date}`}
              className="mb-1 flex-row items-center gap-2"
            >
              <Body className="w-16 text-xs text-muted-foreground">
                {date.slice(5)}
              </Body>
              <View className="flex-row">
                {PERIODS.map(period =>
                  periodDot(
                    hasShiftInPeriod(h.id, date, period),
                    `cross-family-dot-${h.id}-${date}-${period}`
                  )
                )}
              </View>
              <Body className="text-xs text-muted-foreground">
                {PERIOD_LABELS.morning}/{PERIOD_LABELS.afternoon}/
                {PERIOD_LABELS.evening}
              </Body>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
