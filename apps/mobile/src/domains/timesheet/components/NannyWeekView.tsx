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
 *
 * TIER0-CX-SPEC.md §6.1/§7 (Phase 4, additive): the footer also carries her
 * "Add an expense" quick-add + own status list, and — before that, per §7's
 * fixed statement order (item 3, after day rows) — the Reimbursements card
 * when the week has approved claims. Reimbursements are NOT wages
 * (docs/11-MONEY.md §6): they render in their own card, visually and
 * semantically separate from the money line above.
 */
import { FlashList } from '@shopify/flash-list';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { Button } from '@/src/components/ui/button';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { ExpenseAddSheet } from '@/src/domains/expenses/components/ExpenseAddSheet';
import { ExpensesListCard } from '@/src/domains/expenses/components/ExpensesListCard';
import { ReimbursementsCard } from '@/src/domains/expenses/components/ReimbursementsCard';
import type {
  CreateExpenseRequest,
  Expense,
} from '@/src/domains/expenses/types';
import {
  ClockOutSheet,
  type ClockOutSheetSubmitInput,
} from '@/src/domains/today/components/ClockOutSheet';
import { useCreateExpense } from '@/src/hooks/mutations/useCreateExpense';
import { useUpdateExpense } from '@/src/hooks/mutations/useUpdateExpense';
import { useUpdateTimeEntry } from '@/src/hooks/mutations/useUpdateTimeEntry';
import { useWithdrawExpense } from '@/src/hooks/mutations/useWithdrawExpense';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';
import { usePayments } from '@/src/hooks/queries/usePayments';
import { useWeekExpenses } from '@/src/hooks/queries/useWeekExpenses';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { useWeekTimesheet } from '@/src/hooks/queries/useWeekTimesheet';
import { localDateInZone } from '@/src/lib/localDate';
import { useIsOnline } from '@/src/lib/network';
import { showSuccessToast } from '@/src/lib/toast';
import { useAuthStore } from '@/src/store/auth';
import type { TimeEntry } from '../types';
import { formatDuration, formatOvertimeDelta } from '../utils/duration';
import { formatEarningsLongDate } from '../utils/earningsFormat';
import { scheduledMinutesFor, sumEntryMinutes } from '../utils/entryMinutes';
import { derivePaidState } from '../utils/paidState';
import { useReopenedNotice } from '../utils/reopenedNotice';
import { describeTimeEntryWriteError } from '../utils/timeEntryWriteError';
import { EarningsBreakdownSheet } from './EarningsBreakdownSheet';
import { PaidStateCard } from './PaidStateCard';
import { TimeEntryDayRow } from './TimeEntryDayRow';
import { WeekExportAction } from './WeekExportAction';
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
  /** Her membership in this household is `removed` — she keeps the hours and
   * pay she accrued here, but every write is gone: no correction sheet, no
   * expense add/edit/withdraw. Owned by `HoursScreen`, which reads
   * `useIsOnboarded().isPastMember`. */
  readOnly?: boolean;
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
  readOnly = false,
}: NannyWeekViewProps) {
  const { t } = useTranslation('hours');
  const { t: tExpenses } = useTranslation('expenses');
  const { t: tErrors } = useTranslation('errors');
  // Same tab-bar dead-zone fix as Settings (BUG1) — the Hours tab's
  // FlashList needs the same real clearance a fixed magic number can't give.
  const tabBarScrollPadding = useTabBarScrollPadding();
  const currentUserId = useAuthStore(s => s.user?.id ?? null);
  const entriesQuery = useWeekTimeEntries(householdId, weekStartISO);
  const timesheetQuery = useWeekTimesheet(householdId, weekStartISO);
  const expensesQuery = useWeekExpenses(householdId, weekStartISO);
  // Her own arrangement — only read here for the add sheet's mileage-rate
  // hint (TIER0-CX-SPEC.md §6.1); the money line above already covers the
  // rest of what an arrangement is for.
  const arrangementQuery = useCurrentPayArrangement(householdId, currentUserId);
  const updateEntry = useUpdateTimeEntry();
  const createExpense = useCreateExpense(householdId);
  const updateExpense = useUpdateExpense();
  const withdrawExpense = useWithdrawExpense();
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  // The server's refusal of the LAST correction, rendered inside the sheet.
  // It used to be discarded here and toasted from the hook, where a
  // presented BottomSheetBase hid it — see `describeTimeEntryWriteError`.
  const [saveRefusal, setSaveRefusal] = useState<{
    message: string;
    overlappingEntryId: string | null;
  } | null>(null);
  const isOnline = useIsOnline();
  const [isBreakdownVisible, setIsBreakdownVisible] = useState(false);
  const [isAddExpenseVisible, setIsAddExpenseVisible] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  // F-B1-3: BOTH household week reads are household-wide, not self-scoped —
  // in a two-carer household the entries list carries the other carer's
  // hours and the timesheet list carries her pay. Everything below is
  // narrowed to `currentUserId` before a single figure is computed from it.
  const weekTimesheets = timesheetQuery.isError
    ? []
    : (timesheetQuery.data ?? []);
  // Guarded, not just `find`: with no user id, `carer_id === currentUserId`
  // would match a DEPARTED carer's row (`carer_id` NULL, 033) and show her
  // pay here. Fails closed, same as the entries filter below.
  const timesheet = currentUserId
    ? (weekTimesheets.find(t => t.carer_id === currentUserId) ?? null)
    : null;
  const reopened = useReopenedNotice(timesheet?.id, timesheet?.status);
  // Read-only for her, and only once the week is approved — settlement is
  // measured against a FROZEN gross, so there is nothing to show before one
  // exists. Same gate as the parent view, from the other side of the card.
  const paymentsQuery = usePayments(
    timesheet?.status === 'approved' ? timesheet.id : null
  );

  const handleOpenAddExpense = () => {
    setEditingExpense(null);
    setIsAddExpenseVisible(true);
  };
  const handleEditExpense = (expense: Expense) => {
    setEditingExpense(expense);
    setIsAddExpenseVisible(true);
  };
  const handleDismissExpenseSheet = () => {
    setIsAddExpenseVisible(false);
    setEditingExpense(null);
  };
  const handleSubmitExpense = (input: CreateExpenseRequest) => {
    const mutation = editingExpense
      ? updateExpense.mutateAsync({ expenseId: editingExpense.id, input })
      : createExpense.mutateAsync(input);
    mutation
      .then(() => {
        handleDismissExpenseSheet();
        showSuccessToast(
          editingExpense
            ? tExpenses('addSheet.savedToast')
            : tExpenses('addSheet.sentToast')
        );
      })
      .catch(() => undefined);
  };
  const handleWithdrawExpense = (expenseId: string) => {
    withdrawExpense
      .mutateAsync(expenseId)
      .then(() => showSuccessToast(tExpenses('list.withdrawnToast')))
      .catch(() => undefined);
  };

  const openEditor = (entry: TimeEntry) => {
    setSaveRefusal(null);
    setEditing(entry);
  };
  const closeEditor = () => {
    setSaveRefusal(null);
    setEditing(null);
  };

  const handleSaveCorrection = ({
    breakMinutes,
    note,
    clockInAt,
    clockOutAt,
  }: ClockOutSheetSubmitInput) => {
    if (!editing) return;
    setSaveRefusal(null);
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
      // reasoning as ClockInCard's clock-out.
      .then(() => closeEditor())
      .catch((error: unknown) => {
        setSaveRefusal(
          describeTimeEntryWriteError(error, tErrors, timeZone, isOnline)
        );
      });
  };

  if (entriesQuery.isLoading) {
    return <LoadingIndicator testID="hours-loading" />;
  }

  // Same split as `ParentWeekView`: hours failing blanks the screen; a
  // timesheet-only failure keeps the day rows and degrades only the money
  // line (TIER0-CX-SPEC.md §4.5 "Earnings error (hours OK)").
  if (entriesQuery.isError) {
    return (
      <ErrorState
        variant="network"
        onRetry={() => void entriesQuery.refetch()}
      />
    );
  }

  const allEntries = entriesQuery.data ?? [];
  // Fails CLOSED with no user id: showing the household's summed hours under
  // "Your week" is worse than showing nothing.
  const entries = currentUserId
    ? allEntries.filter(e => e.carer_id === currentUserId)
    : [];
  /**
   * "Open that entry" on an overlap refusal. The whole week is already
   * loaded here, so switching the sheet to the conflicting entry is a state
   * swap — no navigation, no refetch. Absent from the loaded week (it can
   * belong to an adjacent week, or to another household) the action simply
   * isn't offered; the message still names the day and range.
   */
  const overlappingEntry = saveRefusal?.overlappingEntryId
    ? (entries.find(e => e.id === saveRefusal.overlappingEntryId) ?? null)
    : null;
  const totalMinutes = sumEntryMinutes(entries, nowMs);
  const overtimeLabel = formatOvertimeDelta(
    totalMinutes,
    scheduledMinutesFor(entries)
  );
  const todayISO = localDateInZone(timeZone, new Date(nowMs));

  const dayRows = weekDates
    .map(date => ({
      date,
      entries: entries.filter(entry => entry.local_date === date),
    }))
    .filter(row => row.entries.length > 0 || row.date === todayISO);

  const earnings = timesheet?.earnings;
  const earningsOk = earnings && earnings.status === 'ok' ? earnings : null;
  const isApproved = timesheet?.status === 'approved';
  const approvedDateLabel =
    isApproved && timesheet?.approved_at
      ? formatEarningsLongDate(
          localDateInZone(timeZone, new Date(timesheet.approved_at))
        )
      : null;

  // TIER0-CX-SPEC.md §6.3/§7: the Reimbursements card is approved-only and
  // shares the week's currency — `earningsOk.currency` when a timesheet
  // exists, else her own arrangement's currency, else the house default.
  const weekExpenses = expensesQuery.data ?? [];
  const approvedExpenses = weekExpenses.filter(e => e.status === 'approved');
  const expensesCurrency =
    earningsOk?.currency ?? arrangementQuery.data?.currency ?? 'GBP';
  // `earningsOk` is null for a week with no server total — `derivePaidState`
  // returns null for that rather than measuring against a fabricated zero
  // (docs/11-MONEY.md §4), and the card then renders nothing.
  const paidState = derivePaidState(
    paymentsQuery.data ?? [],
    earningsOk ? earningsOk.gross_minor : null
  );
  const mileageRateMinor =
    arrangementQuery.data?.mileage_rate_per_mile_minor ?? null;

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
            onEditEntry={readOnly ? undefined : openEditor}
            timesheetStatus={timesheet?.status ?? null}
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
            timesheetStatus={timesheet?.status ?? null}
            showStatusPill={false}
            totalMinutes={totalMinutes}
            earnings={earnings}
            earningsRole="nanny"
            earningsCarerId={timesheet?.carer_id ?? null}
            earningsCarerDisplayName={timesheet?.carer_display_name ?? ''}
            onPressEarnings={() => setIsBreakdownVisible(true)}
            earningsReopened={reopened}
            earningsReopenReason={timesheet?.reopen_reason ?? null}
            earningsError={timesheetQuery.isError}
            onRetryEarnings={() => void timesheetQuery.refetch()}
          />
        }
        ListFooterComponent={
          <>
            {/* §7 fixed order item 3 — after day rows, approved-only,
                never rendered when the week has no approved claims. */}
            <ReimbursementsCard
              approvedExpenses={approvedExpenses}
              totalMinor={earningsOk ? earningsOk.reimbursements_minor : null}
              currency={expensesCurrency}
            />
            {readOnly ? null : (
              <Button
                testID="expenses-add"
                variant="outline"
                className="mt-4"
                onPress={handleOpenAddExpense}
              >
                <Text className="text-foreground">
                  {tExpenses('addButton')}
                </Text>
              </Button>
            )}
            <ExpensesListCard
              expenses={weekExpenses}
              onEdit={readOnly ? undefined : handleEditExpense}
              onWithdraw={readOnly ? undefined : handleWithdrawExpense}
            />
            {/* "Paid £X on <date>", and what is still owed. No
                `onMarkPaidPress` — recording a payment is the paying
                family's action, and its absence is the whole read-only
                contract (see PaidStateCard's module doc). */}
            {isApproved && timesheet ? (
              <>
                <PaidStateCard
                  paidState={paidState}
                  payments={paymentsQuery.data ?? []}
                  currency={expensesCurrency}
                />
                <WeekExportAction
                  timesheetId={timesheet.id}
                  weekStartISO={weekStartISO}
                  weekRangeLabel={weekRangeLabel}
                  carerName={timesheet.carer_display_name}
                  earnings={earningsOk}
                  paidState={paidState}
                />
              </>
            ) : null}
          </>
        }
        contentContainerStyle={{
          ...SCREEN_CONTENT_STYLE,
          paddingBottom: tabBarScrollPadding,
        }}
        ListEmptyComponent={null}
        accessibilityLabel={t('yourWeek')}
      />
      {/* Rendered outside the list so dismissing it never depends on which
          row is still mounted. `visible` alone drives it; a null `editing`
          simply means there is nothing to show. */}
      <ClockOutSheet
        visible={editing !== null}
        onDismiss={closeEditor}
        onSubmit={handleSaveCorrection}
        isSubmitting={updateEntry.isPending}
        mode="edit"
        clockInAt={editing?.clock_in_at ?? null}
        timeZone={timeZone}
        nowMs={nowMs}
        defaultClockOutAt={editing?.clock_out_at ?? undefined}
        initialBreakMinutes={editing?.break_minutes ?? 0}
        initialNote={editing?.note ?? ''}
        submitError={saveRefusal?.message ?? null}
        submitErrorAction={
          overlappingEntry
            ? {
                label: t('openConflictingEntry'),
                onPress: () => openEditor(overlappingEntry),
              }
            : null
        }
      />

      {earningsOk ? (
        <EarningsBreakdownSheet
          visible={isBreakdownVisible}
          onDismiss={() => setIsBreakdownVisible(false)}
          earnings={earningsOk}
          weekRangeLabel={weekRangeLabel}
          approvedDateLabel={approvedDateLabel}
          earningsRole="nanny"
        />
      ) : null}

      <ExpenseAddSheet
        visible={isAddExpenseVisible}
        onDismiss={handleDismissExpenseSheet}
        onSubmit={handleSubmitExpense}
        isSubmitting={createExpense.isPending || updateExpense.isPending}
        todayISO={todayISO}
        householdTimezone={timeZone}
        currency={expensesCurrency}
        mileageRateMinor={mileageRateMinor}
        initialExpense={editingExpense}
      />
    </>
  );
}
