/**
 * @module domains/timesheet/components/ParentWeekView
 * A parent's view of their carer's week: the same per-day hours as the
 * nanny sees, plus "Approve the week" (one tap) and a "Query" escape hatch
 * that takes a note instead of silently withholding approval.
 */
import { FlashList } from '@shopify/flash-list';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { Button } from '@/src/components/ui/button';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Body } from '@/src/components/ui/typography';
import { resolveMemberDisplayName } from '@/src/domains/schedule/utils/memberDisplayName';
import { resolveWeekCarerHeaderName } from '@/src/domains/timesheet/utils/weekCarerHeaderName';
import { useApproveTimesheet } from '@/src/hooks/mutations/useApproveTimesheet';
import { useQueryTimesheet } from '@/src/hooks/mutations/useQueryTimesheet';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { useWeekTimesheet } from '@/src/hooks/queries/useWeekTimesheet';
import { showSuccessToast } from '@/src/lib/toast';
import { useAuthStore } from '@/src/store/auth';
import { TIMESHEET_STATUSES, type TimeEntry } from '../types';
import { formatDuration, formatOvertimeDelta } from '../utils/duration';
import { sumEntryMinutes } from '../utils/entryMinutes';
import { QueryNoteSheet } from './QueryNoteSheet';
import { TimeEntryDayRow } from './TimeEntryDayRow';
import { WeekTotal } from './WeekTotal';

function scheduledMinutesFor(entries: TimeEntry[]): number | null {
  const withSchedule = entries.filter(e => e.scheduled_minutes !== null);
  if (withSchedule.length === 0) return null;
  return withSchedule.reduce((sum, e) => sum + (e.scheduled_minutes ?? 0), 0);
}

interface ParentWeekViewProps {
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
  /** Hide approve/query actions — helpers see the parent view read-only. */
  readOnly?: boolean;
}

export function ParentWeekView({
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
  readOnly = false,
}: ParentWeekViewProps) {
  const { t } = useTranslation('hours');
  const { t: tSchedule } = useTranslation('schedule');
  // Same tab-bar dead-zone fix as Settings (BUG1) — the Hours tab's
  // FlashList needs the same real clearance a fixed magic number can't give.
  const tabBarScrollPadding = useTabBarScrollPadding();
  const currentUserId = useAuthStore(s => s.user?.id ?? null);
  const membersQuery = useHouseholdMembers(householdId);
  const entriesQuery = useWeekTimeEntries(householdId, weekStartISO);
  const timesheetQuery = useWeekTimesheet(householdId, weekStartISO);
  const approveTimesheet = useApproveTimesheet();
  const queryTimesheet = useQueryTimesheet();
  const [isQuerySheetVisible, setIsQuerySheetVisible] = useState(false);

  const membersByUserId = useMemo(
    () =>
      new Map(
        (membersQuery.data ?? []).map(member => [member.user_id, member])
      ),
    [membersQuery.data]
  );
  const memberLabels = useMemo(
    () => ({
      you: tSchedule('detail.you'),
      someone: tSchedule('detail.someone'),
      roleFallback: (role: 'owner' | 'parent' | 'nanny' | 'helper') =>
        tSchedule(`detail.roleFallback.${role}`),
    }),
    [tSchedule]
  );

  if (entriesQuery.isLoading || timesheetQuery.isLoading) {
    return <LoadingIndicator testID="hours-loading" />;
  }

  if (entriesQuery.isError || timesheetQuery.isError) {
    return (
      <ErrorState
        variant="network"
        onRetry={() => {
          void entriesQuery.refetch();
          void timesheetQuery.refetch();
        }}
      />
    );
  }

  const entries = entriesQuery.data ?? [];
  const timesheet = timesheetQuery.data ?? null;
  const totalMinutes = sumEntryMinutes(entries, nowMs);
  const overtimeLabel = formatOvertimeDelta(
    totalMinutes,
    scheduledMinutesFor(entries)
  );
  const entryCarerName =
    entries.find(e => e.carer_display_name)?.carer_display_name ?? null;
  const entryCarerIds = [
    ...new Set(
      entries
        .map(e => e.carer_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ];
  const carerMemberIds = (membersQuery.data ?? [])
    .filter(m => m.role === 'nanny' || m.role === 'helper')
    .map(m => m.user_id);
  const carerName = resolveWeekCarerHeaderName({
    entryCarerIds,
    entryCarerDisplayName: entryCarerName,
    carerMemberIds,
    resolveMemberName: userId =>
      resolveMemberDisplayName(
        userId,
        currentUserId,
        membersByUserId,
        memberLabels
      ),
  });
  const isApproved = timesheet?.status === TIMESHEET_STATUSES.APPROVED;
  // Approve/query are ONLY valid on a 'submitted' timesheet — the API 409s
  // (TIMESHEET_NOT_ACTIONABLE) on 'open' (nothing submitted, no row exists
  // client-side either — see the `!timesheet` guard below), already-
  // 'approved', or already-'queried'. Gating on role alone isn't enough;
  // verified against the live API (api-timesheet's reply, 2026-08-01).
  const isActionable = timesheet?.status === TIMESHEET_STATUSES.SUBMITTED;

  const dayRows = weekDates.map(date => ({
    date,
    entries: entries.filter(entry => entry.local_date === date),
  }));

  // `.mutateAsync(...).then(onFulfilled)` with no rejection handler left a
  // failure's promise entirely unhandled (an "Uncaught (in promise)" in
  // metro.log, the same defect class as the clock-in double-tap bug) even
  // though the mutation's own `onError` still showed a toast. try/catch
  // consumes the rejection here; the toast is unchanged.
  const handleApprove = async () => {
    if (!timesheet || !isActionable || approveTimesheet.isPending) return;
    try {
      await approveTimesheet.mutateAsync(timesheet.id);
    } catch {
      return;
    }
    showSuccessToast(t('approvedToast'));
  };

  const handleQuerySubmit = async (note: string) => {
    if (!timesheet || !isActionable || queryTimesheet.isPending) return;
    try {
      await queryTimesheet.mutateAsync({ timesheetId: timesheet.id, note });
    } catch {
      return;
    }
    setIsQuerySheetVisible(false);
    showSuccessToast(t('queriedToast'));
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
            carerName={carerName}
            timesheetStatus={timesheet?.status ?? null}
            showPayBoundary
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
            {readOnly ? null : (
              <>
                {!isActionable && !isApproved ? (
                  <Body
                    testID="hours-approve-waiting"
                    className="mt-4 text-muted-foreground"
                  >
                    {timesheet?.status === TIMESHEET_STATUSES.QUERIED
                      ? t('waitingAfterQuery')
                      : t('waitingForHours')}
                  </Body>
                ) : null}
                <Button
                  testID="hours-approve-button"
                  className="mt-6"
                  disabled={!isActionable || approveTimesheet.isPending}
                  onPress={() => void handleApprove()}
                >
                  <Text>{isApproved ? t('approved') : t('approveWeek')}</Text>
                </Button>
                <Button
                  testID="hours-query-button"
                  variant="ghost"
                  className="mt-2"
                  disabled={!isActionable}
                  onPress={() => setIsQuerySheetVisible(true)}
                >
                  <Text className="text-destructive">{t('query')}</Text>
                </Button>
              </>
            )}
          </>
        }
        contentContainerStyle={{
          ...SCREEN_CONTENT_STYLE,
          paddingBottom: tabBarScrollPadding,
        }}
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
