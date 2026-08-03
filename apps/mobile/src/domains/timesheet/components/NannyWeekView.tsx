/**
 * @module domains/timesheet/components/NannyWeekView
 * A nanny's own week: per-day hours plus a plainly-stated total (and
 * overtime delta against what was scheduled, when known). Hours only — no
 * payments here.
 */
import { FlashList } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import type { TimeEntry } from '../types';
import { formatDuration, formatOvertimeDelta } from '../utils/duration';
import { sumEntryMinutes } from '../utils/entryMinutes';
import { TimeEntryDayRow } from './TimeEntryDayRow';
import { WeekTotal } from './WeekTotal';

interface NannyWeekViewProps {
  householdId: string;
  weekStartISO: string;
  weekDates: string[];
  weekRangeLabel: string;
  nowMs: number;
  /** Household IANA zone — forwarded to `TimeEntryDayRow` for zone-aware
   * clock times (GOLDEN-FIXES #21 bug class). */
  timeZone: string;
  /** D15 week nav, owned by `HoursScreen` — forwarded straight to `WeekTotal`. */
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  isNextWeekDisabled: boolean;
  isPreviousWeekDisabled: boolean;
}

function scheduledMinutesFor(entries: TimeEntry[]): number | null {
  const withSchedule = entries.filter(e => e.scheduled_minutes !== null);
  if (withSchedule.length === 0) return null;
  return withSchedule.reduce((sum, e) => sum + (e.scheduled_minutes ?? 0), 0);
}

export function NannyWeekView({
  householdId,
  weekStartISO,
  weekDates,
  weekRangeLabel,
  nowMs,
  timeZone,
  onPreviousWeek,
  onNextWeek,
  isNextWeekDisabled,
  isPreviousWeekDisabled,
}: NannyWeekViewProps) {
  const { t } = useTranslation('hours');
  const entriesQuery = useWeekTimeEntries(householdId, weekStartISO);

  if (entriesQuery.isLoading) {
    return <LoadingIndicator testID="hours-loading" />;
  }

  const entries = entriesQuery.data ?? [];
  const totalMinutes = sumEntryMinutes(entries, nowMs);
  const overtimeLabel = formatOvertimeDelta(
    totalMinutes,
    scheduledMinutesFor(entries)
  );

  const dayRows = weekDates.map(date => ({
    date,
    entries: entries.filter(entry => entry.local_date === date),
  }));

  return (
    <FlashList
      testID="hours-week-list"
      data={dayRows}
      keyExtractor={row => row.date}
      renderItem={({ item }) => (
        <TimeEntryDayRow
          testID={`hours-day-${item.date}`}
          date={item.date}
          entries={item.entries}
          nowMs={nowMs}
          timeZone={timeZone}
        />
      )}
      ListHeaderComponent={
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel={weekRangeLabel}
          totalLabel={formatDuration(totalMinutes)}
          overtimeLabel={overtimeLabel}
          onPreviousWeek={onPreviousWeek}
          onNextWeek={onNextWeek}
          isNextDisabled={isNextWeekDisabled}
          isPreviousDisabled={isPreviousWeekDisabled}
        />
      }
      contentContainerStyle={SCREEN_CONTENT_STYLE}
      ListEmptyComponent={null}
      accessibilityLabel={t('yourWeek')}
    />
  );
}
