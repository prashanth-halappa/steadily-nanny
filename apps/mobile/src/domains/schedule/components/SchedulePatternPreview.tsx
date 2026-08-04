/**
 * @module domains/schedule/components/SchedulePatternPreview
 *
 * Compact day/time/children summary for a schedule pattern — used on the
 * parent pending/accepted/declined status screen so they can inspect what
 * they sent without leaving the status card.
 */
import type {
  PauseRange,
  SchedulePatternDay,
} from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Card } from '@/src/components/ui/card';
import { ChildChip } from '@/src/components/ui/child-chip';
import { Body, Small } from '@/src/components/ui/typography';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
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
  until?: string | null;
  exdates?: ReadonlyArray<string>;
  pauseRanges?: ReadonlyArray<PauseRange>;
  testID?: string;
}

export function SchedulePatternPreview({
  days,
  childrenById,
  until = null,
  exdates = [],
  pauseRanges = [],
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
    <Card testID={testID} className="gap-3 p-5.5">
      <Body testID={`${testID}-hours`} className="font-semibold" tabular>
        {t('pending.previewHoursTotal', { hours: totalHours })}
      </Body>
      {until ? (
        <Small testID={`${testID}-until`} className="text-muted-foreground">
          {t('pending.untilLine', { end: formatDisplayDate(until) })}
        </Small>
      ) : null}
      {exdates.length > 0 ? (
        <Small testID={`${testID}-exdates`} className="text-muted-foreground">
          {t('pending.exdatesLine', {
            dates: exdates.map(d => formatDisplayDate(d)).join(', '),
          })}
        </Small>
      ) : null}
      {pauseRanges.length > 0 ? (
        <View testID={`${testID}-pauses`} className="gap-1">
          {pauseRanges.map(range => (
            <Small
              key={`${range.from}-${range.to}`}
              className="text-muted-foreground"
            >
              {t('pending.pauseRangeLine', {
                from: formatDisplayDate(range.from),
                to: formatDisplayDate(range.to),
              })}
            </Small>
          ))}
        </View>
      ) : null}
      {ordered.map(day => (
        <View key={day.id} className="gap-1">
          <Body className="font-medium" tabular>
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
    </Card>
  );
}
