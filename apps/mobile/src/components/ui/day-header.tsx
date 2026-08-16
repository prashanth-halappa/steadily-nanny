/**
 * @module DayHeader
 *
 * Agenda day-section header, extracted so later streams can share it.
 * Keeps the existing `schedule-day-today-${localDate}` and
 * `schedule-day-total-${localDate}` testIDs. Presentational: no queries,
 * no domain imports.
 */

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import {
  DayGroup,
  Figure,
  MetadataLabel,
} from '@/src/components/ui/typography';

const MINUTES_PER_HOUR = 60;

interface DayHeaderProps {
  label: string;
  localDate: string;
  isToday: boolean;
  totalMinutes: number | null;
  testID?: string;
}

/**
 * Compact English duration matching the agenda's current totals
 * (`8h` / `45m` / `1h 30m`). Lives here so this primitive does not
 * import the timesheet domain.
 */
function formatDayTotal(totalMinutes: number): string {
  const minutes = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const remainder = minutes % MINUTES_PER_HOUR;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

export function DayHeader({
  label,
  localDate,
  isToday,
  totalMinutes,
  testID,
}: DayHeaderProps) {
  const { t } = useTranslation('common');

  return (
    <View
      testID={testID}
      className="flex-row items-center justify-between px-5.5 pt-6 pb-2"
    >
      <View className="flex-row items-center gap-2">
        <DayGroup>{label}</DayGroup>
        {isToday ? (
          <View
            testID={`schedule-day-today-${localDate}`}
            className="rounded-chip bg-chip-plum px-2 py-0.5"
          >
            <MetadataLabel className="text-primary">
              {t('tabs.today')}
            </MetadataLabel>
          </View>
        ) : null}
      </View>
      {totalMinutes !== null ? (
        <Figure testID={`schedule-day-total-${localDate}`}>
          {formatDayTotal(totalMinutes)}
        </Figure>
      ) : null}
    </View>
  );
}

export type { DayHeaderProps };
