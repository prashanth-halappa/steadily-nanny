/**
 * @module DayHeader
 *
 * Agenda day-section header, extracted so later streams can share it.
 * Keeps the existing `schedule-day-today-${localDate}` and
 * `schedule-day-total-${localDate}` testIDs. Presentational: no queries,
 * no domain imports. The total is a pre-formatted duration string from
 * the caller — this primitive does not count minutes or format them.
 */

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import {
  DayGroup,
  Figure,
  MetadataLabel,
} from '@/src/components/ui/typography';

interface DayHeaderProps {
  label: string;
  localDate: string;
  isToday: boolean;
  /**
   * Pre-formatted duration ("8h", "0m", "1h 30m"). `null` means omit the
   * total element entirely — distinct from `"0m"`, which is a real zero
   * (every shift that day was cancelled/declined).
   */
  total: string | null;
  testID?: string;
}

export function DayHeader({
  label,
  localDate,
  isToday,
  total,
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
      {total !== null ? (
        <Figure testID={`schedule-day-total-${localDate}`}>{total}</Figure>
      ) : null}
    </View>
  );
}

export type { DayHeaderProps };
