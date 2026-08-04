/**
 * @module domains/schedule/components/WeekRibbonView
 *
 * Calendar week ribbon — full day hours 0–23, cells coloured by shift status
 * (Daylight UX #13: do not paint Pending as Confirmed green). Occupied cells
 * open shift detail so a Week preference is not a read-only dead end.
 * Away days (carer time off) are marked on the weekday header.
 */
import type { CarerTimeOff } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { type Href, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useThemeColors } from '@/lib/design-tokens';
import { Body, Small } from '@/src/components/ui/typography';
import {
  hourCellOccupied,
  localDateToWeekday,
  minutesInZone,
} from '@/src/domains/schedule/utils/shiftGrouping';
import { timeOffCoversLocalDate } from '@/src/domains/schedule/utils/timeOffOverlap';
import { getWeekdayOrder } from '@/src/lib/weekdayOrder';

const HOURS = Array.from({ length: 24 }, (_, i) => i); // 0..23

interface WeekRibbonViewProps {
  shifts: Shift[];
  displayTimeZone?: string | null;
  weekStartsOn?: number | null;
  timeOff?: CarerTimeOff[];
  householdTimeZone?: string;
  weekDates?: string[];
}

function cellStatusColour(
  status: Shift['status'] | undefined,
  colors: ReturnType<typeof useThemeColors>
): string {
  switch (status) {
    case 'confirmed':
    case 'completed':
      return colors.success;
    case 'pending':
    case 'draft':
      return colors.warning;
    case 'declined':
    case 'cancelled':
      return colors.mutedForeground;
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
  return pending ?? occupying[0];
}

export function WeekRibbonView({
  shifts,
  displayTimeZone,
  weekStartsOn = 1,
  timeOff = [],
  householdTimeZone = 'UTC',
  weekDates = [],
}: WeekRibbonViewProps) {
  const { t } = useTranslation('schedule');
  const themeColors = useThemeColors();
  const router = useRouter();
  const displayOrder = getWeekdayOrder(weekStartsOn);

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

  return (
    <ScrollView testID="calendar-week-ribbon-view" className="flex-1 px-4">
      <View className="flex-row pb-2">
        <View className="w-8" />
        {displayOrder.map(dow => (
          <View key={dow} className="flex-1 items-center">
            <Body className="text-xs font-medium">{t(`weekday.${dow}`)}</Body>
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
      {HOURS.map(hour => (
        <View key={hour} className="flex-row items-center py-0.5">
          <Body className="w-8 text-xs text-muted-foreground" tabular>
            {hour}
          </Body>
          {displayOrder.map(dow => {
            const shift = densestShift(shifts, dow, hour, displayTimeZone);
            const status = shift?.status;
            const filled = status !== undefined;
            const colour = cellStatusColour(status, themeColors);
            const cell = (
              <View
                testID={`week-ribbon-cell-${dow}-${hour}`}
                accessibilityState={{ selected: filled }}
                accessibilityLabel={status ?? 'empty'}
                className="mx-0.5 h-4 flex-1 rounded-full"
                style={{
                  backgroundColor: filled ? colour : 'transparent',
                  opacity: filled ? 0.85 : 0.15,
                  borderWidth: 1,
                  borderColor: filled ? colour : themeColors.border,
                }}
              />
            );
            if (!shift) {
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
