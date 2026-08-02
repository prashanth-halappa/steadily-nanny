/**
 * @module domains/schedule/components/SchedulePatternPreview
 *
 * Compact day/time/children summary for a schedule pattern — used on the
 * parent pending/accepted/declined status screen so they can inspect what
 * they sent without leaving the status card.
 */
import type { SchedulePatternDay } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ChildChip } from '@/src/components/ui/child-chip';
import { Body } from '@/src/components/ui/typography';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { getWeekdayOrder } from '@/src/lib/weekdayOrder';
import { calculateWeekTotalHours, formatWallClockTime } from '../utils';

interface ChildInfo {
  id: string;
  name: string;
  colour: string | null;
}

interface DayWithChildren extends SchedulePatternDay {
  children: ReadonlyArray<{ id: string; child_id: string }>;
}

interface SchedulePatternPreviewProps {
  days: ReadonlyArray<DayWithChildren>;
  childrenById: Map<string, ChildInfo>;
  testID?: string;
}

export function SchedulePatternPreview({
  days,
  childrenById,
  testID = 'schedule-pattern-preview',
}: SchedulePatternPreviewProps) {
  const { t } = useTranslation('schedule');
  const profile = useUserProfile();
  const displayOrder = getWeekdayOrder(profile.data?.week_starts_on);
  const totalHours = calculateWeekTotalHours([...days]);
  const ordered = displayOrder
    .map(dow => days.find(d => d.weekday === dow))
    .filter((d): d is DayWithChildren => d !== undefined);

  return (
    <View testID={testID} className="gap-3 rounded-xl border border-border p-4">
      <Body testID={`${testID}-hours`} className="font-sora-semibold">
        {t('pending.previewHoursTotal', { hours: totalHours })}
      </Body>
      {ordered.map(day => (
        <View key={day.id} className="gap-1">
          <Body className="font-sora-medium">
            {t(`weekday.${day.weekday}`)} ·{' '}
            {formatWallClockTime(day.start_time)}–
            {formatWallClockTime(day.end_time)}
          </Body>
          {day.children.length > 0 ? (
            <View className="flex-row flex-wrap gap-2">
              {day.children.map(dc => {
                const child = childrenById.get(dc.child_id);
                return (
                  <ChildChip
                    key={dc.id}
                    name={child?.name ?? ''}
                    colour={child?.colour ?? undefined}
                  />
                );
              })}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}
