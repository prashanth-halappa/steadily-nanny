/**
 * @module domains/timesheet/components/NannyWeekView
 * A nanny's own week: per-day hours plus a plainly-stated total (and
 * overtime delta against what was scheduled, when known). Hours only — no
 * payments here.
 *
 * Daylight UX P0-2 — this is where the correction path lives, because it's
 * the screen a carer is on when she notices a wrong figure. It reuses
 * `ClockOutSheet` in edit mode rather than growing a second sheet: the live
 * summary that shows the recorded total before it's written must have one
 * implementation.
 */
import { FlashList } from '@shopify/flash-list';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import {
  ClockOutSheet,
  type ClockOutSheetSubmitInput,
} from '@/src/domains/today/components/ClockOutSheet';
import { useUpdateTimeEntry } from '@/src/hooks/mutations/useUpdateTimeEntry';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { useWeekTimesheet } from '@/src/hooks/queries/useWeekTimesheet';
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
  const timesheetQuery = useWeekTimesheet(householdId, weekStartISO);
  const updateEntry = useUpdateTimeEntry();
  const [editing, setEditing] = useState<TimeEntry | null>(null);

  const handleSaveCorrection = ({
    breakMinutes,
    note,
    clockInAt,
    clockOutAt,
  }: ClockOutSheetSubmitInput) => {
    if (!editing) return;
    updateEntry
      .mutateAsync({
        entryId: editing.id,
        break_minutes: breakMinutes,
        note,
        ...(clockInAt ? { clock_in_at: clockInAt } : {}),
        ...(clockOutAt ? { clock_out_at: clockOutAt } : {}),
      })
      // Only close on success — the sheet keeps the typed correction so a
      // refusal (an approved week, a bad time) is one retype away, same
      // reasoning as ClockInCard's clock-out. `useUpdateTimeEntry` has
      // already surfaced the failure.
      .then(() => setEditing(null))
      .catch(() => undefined);
  };

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
    <>
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
            onEditEntry={setEditing}
            timesheetStatus={timesheetQuery.data?.status ?? null}
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
      {/* Rendered outside the list so dismissing it never depends on which
          row is still mounted. `visible` alone drives it; a null `editing`
          simply means there is nothing to show. */}
      <ClockOutSheet
        visible={editing !== null}
        onDismiss={() => setEditing(null)}
        onSubmit={handleSaveCorrection}
        isSubmitting={updateEntry.isPending}
        mode="edit"
        clockInAt={editing?.clock_in_at ?? null}
        timeZone={timeZone}
        nowMs={nowMs}
        defaultClockOutAt={editing?.clock_out_at ?? undefined}
        initialBreakMinutes={editing?.break_minutes ?? 0}
        initialNote={editing?.note ?? ''}
      />
    </>
  );
}
