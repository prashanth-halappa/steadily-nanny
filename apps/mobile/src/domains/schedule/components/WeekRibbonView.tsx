/**
 * @module domains/schedule/components/WeekRibbonView
 *
 * Calendar view 2b — simplified hour grid Mon–Sun, hours 7–23.
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { ScrollView, View } from 'react-native';
import { Body } from '@/src/components/ui/typography';
import {
  hourCellOccupied,
  localDateToWeekday,
  minutesInZone,
} from '@/src/domains/schedule/utils/shiftGrouping';
import { getWeekdayOrder } from '@/src/lib/weekdayOrder';

const HOURS = Array.from({ length: 17 }, (_, i) => i + 7); // 7..23
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface WeekRibbonViewProps {
  shifts: Shift[];
  displayTimeZone?: string | null;
  weekStartsOn?: number | null;
}

export function WeekRibbonView({
  shifts,
  displayTimeZone,
  weekStartsOn = 1,
}: WeekRibbonViewProps) {
  const displayOrder = getWeekdayOrder(weekStartsOn);

  // Minute-resolution overlap, not an hour-integer range check — see
  // `hourCellOccupied` for the overnight / sub-hour shifts the old test
  // dropped entirely.
  const cellHasShift = (dow: number, hour: number): boolean =>
    shifts.some(s => {
      const sDow = localDateToWeekday(s.local_date);
      if (sDow !== dow) return false;
      return hourCellOccupied(
        minutesInZone(s.starts_at, displayTimeZone),
        minutesInZone(s.ends_at, displayTimeZone),
        hour
      );
    });

  return (
    <ScrollView testID="calendar-week-ribbon-view" className="flex-1 px-4">
      <View className="flex-row pb-2">
        <View className="w-8" />
        {displayOrder.map(dow => (
          <View key={dow} className="flex-1 items-center">
            <Body className="text-xs font-sora-medium">{DAY_LABELS[dow]}</Body>
          </View>
        ))}
      </View>
      {HOURS.map(hour => (
        <View key={hour} className="flex-row items-center py-0.5">
          <Body className="w-8 text-xs text-muted-foreground">{hour}</Body>
          {displayOrder.map(dow => {
            const filled = cellHasShift(dow, hour);
            return (
              <View
                key={`${dow}-${hour}`}
                testID={`week-ribbon-cell-${dow}-${hour}`}
                className="mx-0.5 h-4 flex-1 rounded-sm"
                style={{
                  backgroundColor: filled ? '#14B8A6' : 'transparent',
                  opacity: filled ? 0.85 : 0.15,
                  borderWidth: 1,
                  borderColor: filled ? '#14B8A6' : '#E5E7EB',
                }}
              />
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}
