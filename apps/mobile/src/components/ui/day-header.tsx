/**
 * Shared day-group header for agenda-style lists. Reproduces the Schedule
 * agenda header exactly, including `schedule-day-today-${localDate}` and
 * `schedule-day-total-${localDate}`.
 *
 * @module components/ui/day-header
 */
import { View } from 'react-native';
import {
  DayGroup,
  Figure,
  MetadataLabel,
} from '@/src/components/ui/typography';

export interface DayHeaderProps {
  label: string;
  localDate: string;
  isToday?: boolean;
  /** Formatted duration; omitted (no total shown) when the day has no shifts. */
  total?: string | null;
  todayLabel: string;
}

export function DayHeader({
  label,
  localDate,
  isToday = false,
  total = null,
  todayLabel,
}: DayHeaderProps) {
  return (
    <View className="flex-row items-center justify-between px-5.5 pt-6 pb-2">
      <View className="flex-row items-center gap-2">
        <DayGroup>{label}</DayGroup>
        {isToday ? (
          <View
            testID={`schedule-day-today-${localDate}`}
            className="rounded-chip bg-chip-plum px-2 py-0.5"
          >
            <MetadataLabel className="text-primary">{todayLabel}</MetadataLabel>
          </View>
        ) : null}
      </View>
      {total !== null ? (
        <Figure testID={`schedule-day-total-${localDate}`}>{total}</Figure>
      ) : null}
    </View>
  );
}
