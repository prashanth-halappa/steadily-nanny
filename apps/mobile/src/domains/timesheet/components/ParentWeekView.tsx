/**
 * @module domains/timesheet/components/ParentWeekView
 * A parent's view of their carer's week: the same per-day hours as the
 * nanny sees, plus "Approve the week" (behind a confirmation dialog,
 * TIER0-CX-SPEC.md §4.3 — approving freezes the gross figure alongside the
 * hours) and a "Query" escape hatch that takes a note instead of silently
 * withholding approval. An approved week also offers "Reopen the week" —
 * the opposite of approve — so a frozen past week can be corrected without
 * a manual DB write.
 *
 * Daylight P0-3: Approve, Query, Reopen, the queried-note and the "waiting"
 * explainer all render INSIDE `WeekTotal` (`primaryAction`/`secondaryAction`/
 * `onReopenPress`/`queryNote`/`actionsNote`), not this component's FlashList
 * footer — they used to sit below every day row and the reimbursements
 * card, several screens down from the figure they act on. This component
 * still owns every handler, dialog and gate (`isActionable`, `readOnly`);
 * `WeekTotal` stays presentational. See that module's doc comment for the
 * card's full vertical order.
 *
 * TIER0-CX-SPEC.md §6.2/§6.3/§7 (Phase 4, additive): the footer also carries
 * the pending-expenses review affordance (action-gated behind `!readOnly`,
 * same as approve/query — a helper sees the statement but never reviews)
 * and, per §7's fixed order (item 3), the read-only Reimbursements card —
 * visible to a helper too, since it is informational, not an action.
 */

import { FlashList } from '@shopify/flash-list';
import type { CreatePaymentInput } from '@steadily-nanny/shared-types/schemas/payment.schema';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Caption } from '@/src/components/ui/typography';
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
import {
  type OverPaymentMetadata,
  overPaymentMetadata,
  useRecordPayment,
} from '@/src/hooks/mutations/useRecordPayment';
import { useReopenTimesheet } from '@/src/hooks/mutations/useReopenTimesheet';
import { useReviewExpense } from '@/src/hooks/mutations/useReviewExpense';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { usePayments } from '@/src/hooks/queries/usePayments';
import { usePendingExpenses } from '@/src/hooks/queries/usePendingExpenses';
import { useWeekExpenses } from '@/src/hooks/queries/useWeekExpenses';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { useWeekTimesheet } from '@/src/hooks/queries/useWeekTimesheet';
import { localDateInZone } from '@/src/lib/localDate';
import { formatMoney } from '@/src/lib/money';
import { showSuccessToast } from '@/src/lib/toast';
import { useAuthStore } from '@/src/store/auth';
import { TIMESHEET_STATUSES } from '../types';
import { carerKeyOf } from '../utils/carerKey';
import { formatDuration, formatOvertimeDelta } from '../utils/duration';
import {
  formatEarningsDuration,
  formatEarningsLongDate,
} from '../utils/earningsFormat';
import { scheduledMinutesFor, sumEntryMinutes } from '../utils/entryMinutes';
import {
  derivePaidState,
  deriveReopenedPaidState,
  sumPaymentsMinor,
} from '../utils/paidState';
import { useReopenedNotice } from '../utils/reopenedNotice';
import { ApproveWeekDialog } from './ApproveWeekDialog';
import { EarningsBreakdownSheet } from './EarningsBreakdownSheet';
import { PaidStateCard } from './PaidStateCard';
import { QueryNoteSheet } from './QueryNoteSheet';
import { RecordPaymentSheet } from './RecordPaymentSheet';
import { ReopenWeekDialog } from './ReopenWeekDialog';
import { TimeEntryDayRow } from './TimeEntryDayRow';
import { WeekExportAction } from './WeekExportAction';
import { WeekTotal } from './WeekTotal';

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
  const colors = useThemeColors();
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
  const recordPayment = useRecordPayment();
  const [isQuerySheetVisible, setIsQuerySheetVisible] = useState(false);
  const [isRecordPaymentVisible, setIsRecordPaymentVisible] = useState(false);
  // The server's own over-payment figures, held so the sheet can state the
  // ceiling it hit. Cleared on every open and every fresh attempt — a stale
  // banner would accuse the parent of a mistake they already corrected.
  const [overPayment, setOverPayment] = useState<OverPaymentMetadata | null>(
    null
  );
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
  // F-B1-3 (S0): both household week reads are household-wide. Which carer
  // this screen is ABOUT is decided once, here, and everything below —
  // total, money line, reimbursements, approve/query/reopen — is derived
  // from that one carer.
  //
  // Migration 033 preserves a departed carer's hours and pay with `carer_id`
  // NULLed and `carer_display_name` kept NOT NULL — so the id alone is not
  // an identity. `carerKeyOf` (see its module doc) is the one rule for which
  // rows are one carer; treating a null id as "no filter" summed an ex-carer
  // into the active carer's card and approved her row, and bucketing all
  // nulls together did the same to two ex-carers.
  // `undefined` — and only `undefined` — means "hasn't picked a tab yet".
  //
  // ponytail: since 058 stamps a per-membership id at insert, only rows whose
  // carer_id was ALREADY null before that migration ran still collapse on a
  // shared display name — there is no membership left to backfill them from.
  const [pickedCarerId, setPickedCarerId] = useState<string | undefined>(
    undefined
  );
  const allEntries = entriesQuery.data ?? [];
  const weekTimesheets = timesheetQuery.isError
    ? []
    : (timesheetQuery.data ?? []);
  const carerSnapshotName = (key: string) =>
    allEntries.find(e => carerKeyOf(e) === key)?.carer_display_name ??
    weekTimesheets.find(t => carerKeyOf(t) === key)?.carer_display_name ??
    '';
  // Sorted by name, not arrival order: a refetch that reorders entries (an
  // edited `clock_in_at`) must not move the parent onto another carer. Ties
  // break on the key so two same-named carers still sort stably.
  const weekCarerIds = [
    ...new Set([
      ...allEntries.map(carerKeyOf),
      ...weekTimesheets.map(carerKeyOf),
    ]),
  ].sort(
    (a, b) =>
      carerSnapshotName(a).localeCompare(carerSnapshotName(b)) ||
      a.localeCompare(b)
  );
  const selectedCarerId =
    pickedCarerId !== undefined && weekCarerIds.includes(pickedCarerId)
      ? pickedCarerId
      : (weekCarerIds[0] ?? null);
  const entries = allEntries.filter(e => carerKeyOf(e) === selectedCarerId);
  const timesheet =
    weekTimesheets.find(t => carerKeyOf(t) === selectedCarerId) ?? null;
  const reopened = useReopenedNotice(timesheet?.id, timesheet?.status);
  // Settlement is measured against a frozen gross, but a reopened week keeps
  // its ledger rows even after the snapshot clears — fetch whenever the week
  // is approved OR carries a reopen reason (submitted-with-reopen_reason).
  const showSettlementHistory =
    timesheet?.status === TIMESHEET_STATUSES.APPROVED ||
    timesheet?.reopen_reason != null;
  const paymentsQuery = usePayments(
    showSettlementHistory && timesheet ? timesheet.id : null
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

  const totalMinutes = sumEntryMinutes(entries, nowMs);
  // A week with visible rows that bank nothing (every entry voided) is not an
  // empty week — "0h" keeps the worked-week frame; "0m" reads like no hours
  // were ever logged.
  const weekHoursLabel =
    entries.length > 0 && totalMinutes === 0
      ? formatDuration(60).replace('1', '0')
      : formatDuration(totalMinutes);
  const overtimeLabel = formatOvertimeDelta(
    totalMinutes,
    scheduledMinutesFor(entries)
  );
  // The selected TAB is the identity — not `carer_id`, which is NULL on every
  // row of a departed carer's tab. Reading raw ids here left this empty for
  // her, and `resolveWeekCarerHeaderName`'s no-entries branch then named the
  // household's sole remaining nanny above her hours (and, through
  // `approveDialogCarerName` below, in the approve dialog too). Passing the
  // key we already bucketed by keeps the header and the total describing the
  // same person, which is the whole point of the tab.
  const entryCarerIds = selectedCarerId ? [selectedCarerId] : [];
  const entryCarerName = selectedCarerId
    ? carerSnapshotName(selectedCarerId) || null
    : null;
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

  const dayRows = weekDates
    .map(date => ({
      date,
      entries: entries.filter(entry => entry.local_date === date),
    }))
    .filter(
      row =>
        row.entries.length > 0 ||
        row.date === localDateInZone(timeZone, new Date(nowMs))
    );

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
  // Carer-scoped for the same reason as the hours: the total under the card
  // comes from THIS carer's `earnings.reimbursements_minor`, so the lines
  // above it must be this carer's claims and no one else's.
  const weekExpenses = weekExpensesQuery.data ?? [];
  const approvedExpenses = weekExpenses.filter(
    e => e.status === 'approved' && carerKeyOf(e) === selectedCarerId
  );
  const expensesCurrency =
    earningsOk?.currency ?? approvedExpenses[0]?.currency ?? 'GBP';

  // TIER0 settlement (067): the ledger measured against the FROZEN gross.
  // `earningsOk` is null for a week with no server total, and `derivePaidState`
  // returns null for that — never `?? 0`, which would render "Paid" over a
  // week whose value is simply unknown (docs/11-MONEY.md §4).
  const payments = paymentsQuery.data ?? [];
  const paidState = earningsOk
    ? derivePaidState(payments, earningsOk.gross_minor)
    : timesheet?.reopen_reason != null
      ? deriveReopenedPaidState(payments)
      : null;
  const settlementCurrency =
    earningsOk?.currency ?? payments[0]?.currency ?? expensesCurrency;
  const paidToDateLabel =
    payments.length > 0
      ? formatMoney(sumPaymentsMinor(payments), settlementCurrency)
      : null;
  const todayISO = localDateInZone(timeZone, new Date(nowMs));

  const handleOpenRecordPayment = () => {
    setOverPayment(null);
    setIsRecordPaymentVisible(true);
  };

  // Sheet-owns-values, screen-owns-mutation: the sheet is closed ONLY on
  // success, so a refusal leaves every typed figure in place — and the
  // over-payment case additionally states the server's own ceiling inline,
  // because a toast alone cannot say which number was too big.
  const handleRecordPayment = async (input: CreatePaymentInput) => {
    if (!timesheet || recordPayment.isPending) return;
    setOverPayment(null);
    try {
      await recordPayment.mutateAsync({ timesheetId: timesheet.id, input });
    } catch (error) {
      setOverPayment(overPaymentMetadata(error));
      return;
    }
    setIsRecordPaymentVisible(false);
    showSuccessToast(t('paid.recordedToast'));
  };

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
          <>
            {/* F-B1-3: two carers, two pay records, two approvals. One
                carer at a time, so the figure on the card is always the
                figure the button below approves. A departed carer gets a
                tab like anyone else — hiding her is what let her hours be
                summed into someone else's. Hidden entirely when the week
                has one carer: the single-carer screen is unchanged. */}
            {weekCarerIds.length > 1 ? (
              <View
                testID="hours-carer-switcher"
                className="mb-3 flex-row rounded-chip bg-muted p-1"
              >
                {weekCarerIds.map(id => {
                  const isSelected = id === selectedCarerId;
                  // Unselected + her timesheet is 'submitted' — a nudge that
                  // another carer's week is waiting on this parent, without
                  // naming it (a status word here would fight the segmented
                  // control's one-line label). Never on the selected segment
                  // — she already sees the full StatusPill on the card below.
                  const hasPendingApproval =
                    !isSelected &&
                    weekTimesheets.find(t => carerKeyOf(t) === id)?.status ===
                      TIMESHEET_STATUSES.SUBMITTED;
                  return (
                    <Pressable
                      key={id}
                      testID={`hours-carer-tab-${id}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => setPickedCarerId(id)}
                      className={cn(
                        'flex-1 flex-row items-center justify-center gap-1.5 rounded-chip px-3 py-3',
                        isSelected ? 'bg-primary' : 'bg-transparent'
                      )}
                    >
                      <Caption
                        className={
                          isSelected
                            ? 'text-primary-foreground'
                            : 'text-foreground'
                        }
                        weight="medium"
                      >
                        {carerSnapshotName(id).split(' ')[0]}
                      </Caption>
                      {hasPendingApproval ? (
                        <View
                          testID={`hours-carer-tab-${id}-pending-dot`}
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: colors.warning }}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <WeekTotal
              testID="hours-week-total"
              weekRangeLabel={weekRangeLabel}
              totalLabel={weekHoursLabel}
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
              approvedDateLabel={approvedDateLabel}
              // Daylight P0-3: gated internally on `timesheetStatus ===
              // 'queried'`, same belt-and-braces the old footer render used
              // — a stale note from a since-resolved query never shows.
              queryNote={timesheet?.query_note ?? null}
              // Walkthrough fix 1 — the reopen affordance lives in the
              // summary card, next to the status pill/gross, not below the
              // day rows. `readOnly` (a helper) never gets a handler, so a
              // helper never sees `hours-reopen-button` even on an approved
              // week.
              onReopenPress={
                readOnly ? undefined : () => setIsReopenDialogOpen(true)
              }
              isReopenPending={reopenTimesheet.isPending}
              // Daylight P0-3: Approve/Query move from the FlashList footer
              // (several screens below every day row) into this card, next
              // to the figure they act on. Every existing gate is preserved
              // — `isActionable`, `readOnly`, the disabled label swap.
              primaryAction={
                readOnly
                  ? null
                  : {
                      testID: 'hours-approve-button',
                      label: isApproved ? t('approved') : t('approveWeek'),
                      disabled: !isActionable || approveTimesheet.isPending,
                      onPress: () => setIsApproveDialogOpen(true),
                    }
              }
              secondaryAction={
                readOnly
                  ? null
                  : {
                      testID: 'hours-query-button',
                      label: t('query'),
                      disabled: !isActionable,
                      destructive: true,
                      onPress: () => setIsQuerySheetVisible(true),
                    }
              }
              actionsNote={
                readOnly || isActionable || isApproved
                  ? null
                  : timesheet?.status === TIMESHEET_STATUSES.QUERIED
                    ? t('waitingAfterQuery')
                    : t('waitingForHours')
              }
            />
          </>
        }
        ListFooterComponent={
          <>
            {/* §7 fixed order item 3 — after day rows, approved-only,
                read-only so it renders for a helper too. */}
            <ReimbursementsCard
              approvedExpenses={approvedExpenses}
              totalMinor={earningsOk ? earningsOk.reimbursements_minor : null}
              currency={expensesCurrency}
              carerName={carerName ?? undefined}
            />
            {/* §7: settlement sits after the statement it settles. Both are
                read-only for a helper — a helper may SEE that the family has
                paid, and may never record that they have. */}
            {showSettlementHistory && timesheet ? (
              <>
                <PaidStateCard
                  paidState={paidState}
                  payments={payments}
                  currency={settlementCurrency}
                  onMarkPaidPress={
                    isApproved && !readOnly
                      ? handleOpenRecordPayment
                      : undefined
                  }
                  isMarkPaidDisabled={recordPayment.isPending}
                />
                {isApproved ? (
                  <WeekExportAction
                    timesheetId={timesheet.id}
                    weekStartISO={weekStartISO}
                    weekRangeLabel={weekRangeLabel}
                    carerName={approveDialogCarerName}
                    earnings={earningsOk}
                    paidState={paidState}
                  />
                ) : null}
              </>
            ) : null}
            {/* Daylight P0-3: the query note, the "waiting" explainer and
                the Approve/Query buttons all moved into the summary card
                above (`WeekTotal`'s `queryNote`/`actionsNote`/
                `primaryAction`/`secondaryAction`) — next to the figure they
                act on, not several screens below every day row. */}
            {readOnly ? null : (
              // §6.2 — above the approve actions (which now live in the card).
              <PendingExpensesRow
                pendingExpenses={pendingExpenses}
                onPress={() => setIsExpenseReviewVisible(true)}
              />
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
        earningsStatus={earnings?.status}
        carerName={approveDialogCarerName}
      />

      <ReopenWeekDialog
        open={isReopenDialogOpen}
        onOpenChange={setIsReopenDialogOpen}
        onConfirm={handleConfirmReopen}
        isSubmitting={reopenTimesheet.isPending}
        weekRangeLabel={weekRangeLabel}
        paidToDateLabel={paidToDateLabel}
      />

      {timesheet && !readOnly ? (
        <RecordPaymentSheet
          visible={isRecordPaymentVisible}
          onDismiss={() => setIsRecordPaymentVisible(false)}
          onSubmit={input => void handleRecordPayment(input)}
          isSubmitting={recordPayment.isPending}
          outstandingMinor={paidState?.balanceMinor ?? 0}
          currency={earningsOk?.currency ?? 'GBP'}
          todayISO={todayISO}
          householdTimezone={timeZone}
          carerName={approveDialogCarerName}
          weekRangeLabel={weekRangeLabel}
          overPayment={overPayment}
        />
      ) : null}

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
