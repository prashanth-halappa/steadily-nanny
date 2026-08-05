/**
 * @module domains/timesheet/components/ParentWeekView
 * A parent's view of their carer's week: the same per-day hours as the
 * nanny sees, plus "Approve the week" (behind a confirmation dialog,
 * TIER0-CX-SPEC.md §4.3 — approving freezes the gross figure alongside the
 * hours) and a "Query" escape hatch that takes a note instead of silently
 * withholding approval. An approved week also offers "Reopen the week" —
 * the opposite of approve — so a frozen past week can be corrected without
 * a manual DB write. Reopen's own `hours-reopen-button` renders inside
 * `WeekTotal` (the FlashList header), not this footer — see that module's
 * doc comment for why it needs to be above the fold.
 *
 * TIER0-CX-SPEC.md §6.2/§6.3/§7 (Phase 4, additive): the footer also carries
 * the pending-expenses review affordance (action-gated behind `!readOnly`,
 * same as approve/query — a helper sees the statement but never reviews)
 * and, per §7's fixed order (item 3), the read-only Reimbursements card —
 * visible to a helper too, since it is informational, not an action.
 */

import { FlashList } from '@shopify/flash-list';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { Button } from '@/src/components/ui/button';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Body } from '@/src/components/ui/typography';
import { ExpenseReviewSheet } from '@/src/domains/expenses/components/ExpenseReviewSheet';
import { PendingExpensesRow } from '@/src/domains/expenses/components/PendingExpensesRow';
import { ReimbursementsCard } from '@/src/domains/expenses/components/ReimbursementsCard';
import {
  isTypedReviewError,
  reviewErrorReason,
} from '@/src/domains/expenses/utils/reviewErrorReason';
import { resolveMemberDisplayName } from '@/src/domains/schedule/utils/memberDisplayName';
import { resolveWeekCarerHeaderName } from '@/src/domains/timesheet/utils/weekCarerHeaderName';
import { useApproveTimesheet } from '@/src/hooks/mutations/useApproveTimesheet';
import { useQueryTimesheet } from '@/src/hooks/mutations/useQueryTimesheet';
import { useReopenTimesheet } from '@/src/hooks/mutations/useReopenTimesheet';
import { useReviewExpense } from '@/src/hooks/mutations/useReviewExpense';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { usePendingExpenses } from '@/src/hooks/queries/usePendingExpenses';
import { useWeekExpenses } from '@/src/hooks/queries/useWeekExpenses';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { useWeekTimesheet } from '@/src/hooks/queries/useWeekTimesheet';
import { localDateInZone } from '@/src/lib/localDate';
import { formatMoney } from '@/src/lib/money';
import { showSuccessToast } from '@/src/lib/toast';
import { useAuthStore } from '@/src/store/auth';
import { TIMESHEET_STATUSES, type TimeEntry } from '../types';
import { formatDuration, formatOvertimeDelta } from '../utils/duration';
import {
  formatEarningsDuration,
  formatEarningsLongDate,
} from '../utils/earningsFormat';
import { sumEntryMinutes } from '../utils/entryMinutes';
import { useReopenedNotice } from '../utils/reopenedNotice';
import { ApproveWeekDialog } from './ApproveWeekDialog';
import { EarningsBreakdownSheet } from './EarningsBreakdownSheet';
import { QueryNoteSheet } from './QueryNoteSheet';
import { ReopenWeekDialog } from './ReopenWeekDialog';
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
  const { t: tExpenses } = useTranslation('expenses');
  const router = useRouter();
  // Same tab-bar dead-zone fix as Settings (BUG1) — the Hours tab's
  // FlashList needs the same real clearance a fixed magic number can't give.
  const tabBarScrollPadding = useTabBarScrollPadding();
  const currentUserId = useAuthStore(s => s.user?.id ?? null);
  const membersQuery = useHouseholdMembers(householdId);
  const entriesQuery = useWeekTimeEntries(householdId, weekStartISO);
  const timesheetQuery = useWeekTimesheet(householdId, weekStartISO);
  const weekExpensesQuery = useWeekExpenses(householdId, weekStartISO);
  // Household-wide, not week-scoped — the review inbox spans every week
  // that has a still-`pending` claim (TIER0-CX-SPEC.md §6.2).
  const pendingExpensesQuery = usePendingExpenses(householdId);
  const approveTimesheet = useApproveTimesheet();
  const queryTimesheet = useQueryTimesheet();
  const reopenTimesheet = useReopenTimesheet();
  const reviewExpense = useReviewExpense();
  const [isQuerySheetVisible, setIsQuerySheetVisible] = useState(false);
  const [isApproveDialogOpen, setIsApproveDialogOpen] = useState(false);
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [isBreakdownVisible, setIsBreakdownVisible] = useState(false);
  const [isExpenseReviewVisible, setIsExpenseReviewVisible] = useState(false);
  const [submittingExpenseId, setSubmittingExpenseId] = useState<string | null>(
    null
  );
  const [mileageRateErrorId, setMileageRateErrorId] = useState<string | null>(
    null
  );
  // Phase 3+4 adversarial review, finding 6 — see ExpenseReviewSheet's
  // WEEK-LOCKED and GENERIC TYPED-ERROR ARM docs.
  const [weekLockedErrorId, setWeekLockedErrorId] = useState<string | null>(
    null
  );
  const [genericErrorId, setGenericErrorId] = useState<string | null>(null);
  const reopened = useReopenedNotice(
    timesheetQuery.data?.id,
    timesheetQuery.data?.status
  );

  const pendingExpenses = pendingExpensesQuery.data ?? [];

  const handleApproveExpense = async (expenseId: string) => {
    setSubmittingExpenseId(expenseId);
    setMileageRateErrorId(null);
    setWeekLockedErrorId(null);
    setGenericErrorId(null);
    try {
      await reviewExpense.mutateAsync({
        expenseId,
        input: { status: 'approved' },
      });
    } catch (error) {
      const reason = reviewErrorReason(error);
      if (reason === 'NO_MILEAGE_RATE') {
        setMileageRateErrorId(expenseId);
      } else if (reason === 'EXPENSE_WEEK_LOCKED') {
        // Finding 6, decided API-side: the claim's week is already
        // approved and reimbursements must not un-approve it. Naming that
        // matters — the generic copy invites a retry that cannot succeed.
        setWeekLockedErrorId(expenseId);
      } else if (isTypedReviewError(error)) {
        setGenericErrorId(expenseId);
      }
      setSubmittingExpenseId(null);
      return;
    }
    setSubmittingExpenseId(null);
    showSuccessToast(tExpenses('reviewSheet.approvedToast'));
  };

  const handleRejectExpense = async (expenseId: string, note: string) => {
    setSubmittingExpenseId(expenseId);
    setGenericErrorId(null);
    try {
      await reviewExpense.mutateAsync({
        expenseId,
        input: { status: 'rejected', ...(note ? { review_note: note } : {}) },
      });
    } catch (error) {
      // Reject has no mileage-rate arm, but the SAME already-approved-week
      // refusal can plausibly hit a reject too — see the TODO above.
      if (isTypedReviewError(error)) {
        setGenericErrorId(expenseId);
      }
      setSubmittingExpenseId(null);
      return;
    }
    setSubmittingExpenseId(null);
    showSuccessToast(tExpenses('reviewSheet.rejectedToast'));
  };

  const handleSetRatePress = () => {
    const erroring = pendingExpenses.find(e => e.id === mileageRateErrorId);
    const carerId = erroring?.carer_id ?? null;
    setIsExpenseReviewVisible(false);
    router.push(
      (carerId ? `/settings/pay/${carerId}` : '/settings/pay') as Href
    );
  };

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

  // Hours (`entriesQuery`) failing blanks the whole screen — there is
  // nothing honest left to show without the record itself. A timesheet-only
  // failure is different: TIER0-CX-SPEC.md §4.5 "Earnings error (hours OK)"
  // requires the day rows to keep rendering, degrading only the money line
  // to a retry affordance (`earningsError` below) — approve/query simply
  // have nothing to act on without the timesheet row, which the `!timesheet`
  // guards already in this component handle the same as "not yet loaded".
  if (entriesQuery.isError) {
    return (
      <ErrorState
        variant="network"
        onRetry={() => void entriesQuery.refetch()}
      />
    );
  }

  const entries = entriesQuery.data ?? [];
  const timesheet = timesheetQuery.isError
    ? null
    : (timesheetQuery.data ?? null);
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

  // TIER0-CX-SPEC.md §4 — the money surface. `earnings` is `undefined` only
  // when there is no timesheet row at all yet (nothing clocked out this
  // week); `WeekTotal` renders no money line in that case.
  const earnings = timesheet?.earnings;
  // Narrowed via a fresh binding, not a separately-named boolean — TS only
  // narrows `earnings` itself from a check performed directly on it.
  const earningsOk = earnings && earnings.status === 'ok' ? earnings : null;
  const approvedDateLabel =
    isApproved && timesheet?.approved_at
      ? formatEarningsLongDate(
          localDateInZone(timeZone, new Date(timesheet.approved_at))
        )
      : null;
  const grossLabel = earningsOk
    ? formatMoney(earningsOk.gross_minor, earningsOk.currency)
    : null;
  const approveDialogCarerName =
    carerName ?? timesheet?.carer_display_name ?? tSchedule('detail.someone');

  // TIER0-CX-SPEC.md §6.3/§7: approved-only, this week's currency.
  // `currency` is deliberately NOT on the wire `Timesheet` (only inside
  // `earnings.currency`, per `TimesheetWeekSchema`'s doc comment), so the
  // fallback below reads an approved expense's own currency instead.
  const weekExpenses = weekExpensesQuery.data ?? [];
  const approvedExpenses = weekExpenses.filter(e => e.status === 'approved');
  const expensesCurrency =
    earningsOk?.currency ?? approvedExpenses[0]?.currency ?? 'GBP';

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

  // Closing the dialog is explicit here (not relied on from the primitive's
  // own auto-close) — same discipline as `ManageHouseholdScreen`'s timezone
  // confirmation, which sets its own `isTimezoneConfirmOpen` to false before
  // calling its mutation.
  const handleConfirmApprove = () => {
    setIsApproveDialogOpen(false);
    void handleApprove();
  };

  const handleReopen = async (reason: string) => {
    if (!timesheet || !isApproved || reopenTimesheet.isPending) return;
    try {
      await reopenTimesheet.mutateAsync({ timesheetId: timesheet.id, reason });
    } catch {
      return;
    }
    showSuccessToast(t('reopenedToast'));
  };

  const handleConfirmReopen = (reason: string) => {
    setIsReopenDialogOpen(false);
    void handleReopen(reason);
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
            totalMinutes={totalMinutes}
            earnings={earnings}
            earningsRole="parent"
            earningsCarerId={timesheet?.carer_id ?? null}
            earningsCarerDisplayName={timesheet?.carer_display_name ?? ''}
            onPressEarnings={() => setIsBreakdownVisible(true)}
            earningsReopened={reopened}
            earningsReopenReason={timesheet?.reopen_reason ?? null}
            earningsError={timesheetQuery.isError}
            onRetryEarnings={() => void timesheetQuery.refetch()}
            // Walkthrough fix 1 — the reopen affordance lives in the
            // summary card, next to the status pill/gross, not below the
            // day rows. `readOnly` (a helper) never gets a handler, so a
            // helper never sees `hours-reopen-button` even on an approved
            // week.
            onReopenPress={
              readOnly ? undefined : () => setIsReopenDialogOpen(true)
            }
            isReopenPending={reopenTimesheet.isPending}
          />
        }
        ListFooterComponent={
          <>
            {/* §7 fixed order item 3 — after day rows, approved-only,
                read-only so it renders for a helper too. */}
            <ReimbursementsCard
              approvedExpenses={approvedExpenses}
              totalMinor={earningsOk ? earningsOk.reimbursements_minor : null}
              currency={expensesCurrency}
            />
            {/* Gated on status, not just a truthy note: `query_note` only
                means "queried" while status is genuinely 'queried'. The API
                never writes a reopen reason here (it lives in the day-thread
                audit event instead — see timesheetCommandService.reopen's
                doc comment), but this stays status-gated as the same
                belt-and-braces `buildInboxItems` already applies, so a
                stale or future-mistaken note can never mislabel a
                reopened/approved week as an open dispute. */}
            {timesheet?.status === TIMESHEET_STATUSES.QUERIED &&
            timesheet.query_note ? (
              <Body
                testID="hours-query-note"
                className="mt-4 text-muted-foreground"
              >
                {t('queriedWithNote', { note: timesheet.query_note })}
              </Body>
            ) : null}
            {readOnly ? null : (
              <>
                {/* §6.2 — above the approve actions. */}
                <PendingExpensesRow
                  pendingExpenses={pendingExpenses}
                  onPress={() => setIsExpenseReviewVisible(true)}
                />
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
                  onPress={() => setIsApproveDialogOpen(true)}
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

      <ApproveWeekDialog
        open={isApproveDialogOpen}
        onOpenChange={setIsApproveDialogOpen}
        onConfirm={handleConfirmApprove}
        isSubmitting={approveTimesheet.isPending}
        weekRangeLabel={weekRangeLabel}
        hoursLabel={formatEarningsDuration(totalMinutes)}
        grossLabel={grossLabel}
        carerName={approveDialogCarerName}
      />

      <ReopenWeekDialog
        open={isReopenDialogOpen}
        onOpenChange={setIsReopenDialogOpen}
        onConfirm={handleConfirmReopen}
        isSubmitting={reopenTimesheet.isPending}
        weekRangeLabel={weekRangeLabel}
      />

      {earningsOk ? (
        <EarningsBreakdownSheet
          visible={isBreakdownVisible}
          onDismiss={() => setIsBreakdownVisible(false)}
          earnings={earningsOk}
          weekRangeLabel={weekRangeLabel}
          approvedDateLabel={approvedDateLabel}
          earningsRole="parent"
        />
      ) : null}

      {readOnly ? null : (
        <ExpenseReviewSheet
          visible={isExpenseReviewVisible}
          onDismiss={() => setIsExpenseReviewVisible(false)}
          expenses={pendingExpenses}
          onApprove={id => void handleApproveExpense(id)}
          onReject={(id, note) => void handleRejectExpense(id, note)}
          submittingId={submittingExpenseId}
          mileageRateErrorId={mileageRateErrorId}
          weekLockedErrorId={weekLockedErrorId}
          genericErrorId={genericErrorId}
          onSetRatePress={handleSetRatePress}
        />
      )}
    </>
  );
}
