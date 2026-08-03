/**
 * @module domains/schedule/components/WeekRibbonView
 *
 * Calendar week ribbon — full day hours 0–23, cells coloured by shift status
 * (Daylight UX #13: do not paint Pending as Confirmed green).
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useThemeColors } from '@/lib/design-tokens';
import { Body } from '@/src/components/ui/typography';
import {
  hourCellOccupied,
  localDateToWeekday,
  minutesInZone,
} from '@/src/domains/schedule/utils/shiftGrouping';
import { getWeekdayOrder } from '@/src/lib/weekdayOrder';

const HOURS = Array.from({ length: 24 }, (_, i) => i); // 0..23

interface WeekRibbonViewProps {
  shifts: Shift[];
  displayTimeZone?: string | null;
  weekStartsOn?: number | null;
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

function densestStatus(
  shifts: Shift[],
  dow: number,
  hour: number,
  displayTimeZone?: string | null
): Shift['status'] | undefined {
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
  return pending?.status ?? occupying[0]?.status;
}

export function WeekRibbonView({
  shifts,
  displayTimeZone,
  weekStartsOn = 1,
}: WeekRibbonViewProps) {
  const { t } = useTranslation('schedule');
  const themeColors = useThemeColors();
  const displayOrder = getWeekdayOrder(weekStartsOn);

  return (
    <ScrollView testID="calendar-week-ribbon-view" className="flex-1 px-4">
      <View className="flex-row pb-2">
        <View className="w-8" />
        {displayOrder.map(dow => (
          <View key={dow} className="flex-1 items-center">
            <Body className="text-xs font-medium">{t(`weekday.${dow}`)}</Body>
          </View>
        ))}
      </View>
      {HOURS.map(hour => (
        <View key={hour} className="flex-row items-center py-0.5">
          <Body className="w-8 text-xs text-muted-foreground" tabular>
            {hour}
          </Body>
          {displayOrder.map(dow => {
            const status = densestStatus(shifts, dow, hour, displayTimeZone);
            const filled = status !== undefined;
            const colour = cellStatusColour(status, themeColors);
            return (
              <View
                key={`${dow}-${hour}`}
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
          })}
        </View>
      ))}
    </ScrollView>
  );
}
