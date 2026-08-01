/**
 * @module domains/timesheet/components/ParentWeekView
 * A parent's view of their carer's week: the same per-day hours as the
 * nanny sees, plus "Approve the week" (one tap) and a "Query" escape hatch
 * that takes a note instead of silently withholding approval.
 */
import { FlashList } from '@shopify/flash-list';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/button';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Body } from '@/src/components/ui/typography';
import { useApproveTimesheet } from '@/src/hooks/mutations/useApproveTimesheet';
import { useQueryTimesheet } from '@/src/hooks/mutations/useQueryTimesheet';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { useWeekTimesheet } from '@/src/hooks/queries/useWeekTimesheet';
import { showSuccessToast } from '@/src/lib/toast';
import { TIMESHEET_STATUSES } from '../types';
import { formatDuration } from '../utils/duration';
import { sumEntryMinutes } from '../utils/entryMinutes';
import { QueryNoteSheet } from './QueryNoteSheet';
import { TimeEntryDayRow } from './TimeEntryDayRow';
import { WeekTotal } from './WeekTotal';

interface ParentWeekViewProps {
  householdId: string;
  weekStartISO: string;
  weekDates: string[];
  weekRangeLabel: string;
  nowMs: number;
}

export function ParentWeekView({
  householdId,
  weekStartISO,
  weekDates,
  weekRangeLabel,
  nowMs,
}: ParentWeekViewProps) {
  const { t } = useTranslation('hours');
  const entriesQuery = useWeekTimeEntries(householdId, weekStartISO);
  const timesheetQuery = useWeekTimesheet(householdId, weekStartISO);
  const approveTimesheet = useApproveTimesheet();
  const queryTimesheet = useQueryTimesheet();
  const [isQuerySheetVisible, setIsQuerySheetVisible] = useState(false);

  if (entriesQuery.isLoading || timesheetQuery.isLoading) {
    return <LoadingIndicator testID="hours-loading" />;
  }

  const entries = entriesQuery.data ?? [];
  const timesheet = timesheetQuery.data ?? null;
  const totalMinutes = sumEntryMinutes(entries, nowMs);
  const isApproved = timesheet?.status === TIMESHEET_STATUSES.APPROVED;

  const dayRows = weekDates.map(date => ({
    date,
    entries: entries.filter(entry => entry.local_date === date),
  }));

  const handleApprove = () => {
    if (!timesheet) return;
    void approveTimesheet.mutateAsync(timesheet.id).then(() => {
      showSuccessToast(t('approvedToast'));
    });
  };

  const handleQuerySubmit = (note: string) => {
    if (!timesheet) return;
    void queryTimesheet
      .mutateAsync({ timesheetId: timesheet.id, note })
      .then(() => {
        setIsQuerySheetVisible(false);
        showSuccessToast(t('queriedToast'));
      });
  };

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
          />
        )}
        ListHeaderComponent={
          <WeekTotal
            testID="hours-week-total"
            weekRangeLabel={weekRangeLabel}
            totalLabel={formatDuration(totalMinutes)}
            overtimeLabel={null}
          />
        }
        ListFooterComponent={
          <>
            {timesheet?.query_note ? (
              <Body
                testID="hours-query-note"
                className="mt-4 text-muted-foreground"
              >
                {t('queriedWithNote', { note: timesheet.query_note })}
              </Body>
            ) : null}
            <Button
              testID="hours-approve-button"
              className="mt-6"
              disabled={!timesheet || isApproved || approveTimesheet.isPending}
              onPress={handleApprove}
            >
              <Text>{isApproved ? t('approved') : t('approveWeek')}</Text>
            </Button>
            <Button
              testID="hours-query-button"
              variant="ghost"
              className="mt-2"
              disabled={!timesheet}
              onPress={() => setIsQuerySheetVisible(true)}
            >
              <Text className="text-destructive">{t('query')}</Text>
            </Button>
          </>
        }
        contentContainerStyle={{ padding: 24, paddingBottom: 100 }}
        accessibilityLabel={t('carerWeek')}
      />

      <QueryNoteSheet
        visible={isQuerySheetVisible}
        onDismiss={() => setIsQuerySheetVisible(false)}
        onSubmit={handleQuerySubmit}
        isSubmitting={queryTimesheet.isPending}
        title={t('queryTitle')}
        hint={t('queryHint')}
        placeholder={t('queryNotePlaceholder')}
        submitLabel={t('querySubmit')}
      />
    </>
  );
}
