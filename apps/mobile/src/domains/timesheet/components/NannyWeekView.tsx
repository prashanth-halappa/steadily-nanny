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
 * Daylight P0-5 — the biggest trust gap this pass found: the person whose
 * pay it is could not see whether her week was open, submitted, queried or
 * approved (`WeekTotal` used to be called here with `showStatusPill={false}`).
 * She now gets the same StatusPill the parent's card used to show, worded
 * from her own side of the conversation (`WeekTotal`'s `timesheetPillLabel`
 * role fork), plus — once approved — an appreciation line naming the
 * household and the date, and the gross, that WeekTotal itself omits rather
 * than fabricates when the total isn't known (docs/11-MONEY.md).
 *

 * TIER0-CX-SPEC.md §6.1/§7 (Phase 4, additive): the footer also carries her
 * "Add an expense" quick-add + own status list, and — before that, per §7's
 * fixed statement order (item 3, after day rows) — the Reimbursements card
 * when the week has approved claims. Reimbursements are NOT wages
 * (docs/11-MONEY.md §6): they render in their own card, visually and
 * semantically separate from the money line above.
 *
 * There is no submit act by design (timesheet.schema.ts). Once her last
 * scheduled shift of the current week has ended and she has hours, a
 * `ReceiptCard` sits directly under `WeekTotal` as her closing beat. It
 * does not fire on an approved week — the appreciation block owns that.
 *
 * 3-T1 / M12 (`docs/design/attention-and-notifications.md` §3.1): she can
 * open a conversation too. `WeekQueryThread` sits under that receipt (or
 * under `WeekTotal` when there is none), and "This doesn't look right"
 * under the money card opens the same composer on a `submitted` or
 * `approved` week. It changes NO status, blocks nothing, and edits no
 * money — it writes one message on an append-only log. The copy is
 * deliberately unloaded: not "Dispute", not "Raise an issue".
 *
 * `queried` is NOT a read-only state here, and must never become one — only
 * `approved` is. Correcting the day IS how a query resolves (D16): she fixes
 * Thursday, the roll-up returns the week to `submitted`, the parent
 * approves. A thread that lets her argue but not correct the record is P1
 * with extra steps.
 */
import { FlashList } from '@shopify/flash-list';
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { ReceiptCard } from '@/src/components/ui/receipt-card';
import { Body } from '@/src/components/ui/typography';
import { ExpenseAddSheet } from '@/src/domains/expenses/components/ExpenseAddSheet';
import { ExpensesListCard } from '@/src/domains/expenses/components/ExpensesListCard';
import { ReimbursementsCard } from '@/src/domains/expenses/components/ReimbursementsCard';
import type {
  CreateExpenseRequest,
  Expense,
} from '@/src/domains/expenses/types';
import { resolveMemberDisplayName } from '@/src/domains/schedule/utils/memberDisplayName';
import {
  ClockOutSheet,
  type ClockOutSheetSubmitInput,
} from '@/src/domains/today/components/ClockOutSheet';
import { useAddTimesheetThreadMessage } from '@/src/hooks/mutations/useAddTimesheetThreadMessage';
import { useCreateExpense } from '@/src/hooks/mutations/useCreateExpense';
import { useUpdateExpense } from '@/src/hooks/mutations/useUpdateExpense';
import { useUpdateTimeEntry } from '@/src/hooks/mutations/useUpdateTimeEntry';
import { useVoidTimeEntry } from '@/src/hooks/mutations/useVoidTimeEntry';
import { useWithdrawExpense } from '@/src/hooks/mutations/useWithdrawExpense';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { usePayments } from '@/src/hooks/queries/usePayments';
import { useReimbursementSettlements } from '@/src/hooks/queries/useReimbursementSettlements';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { useTimesheetThread } from '@/src/hooks/queries/useTimesheetThread';
import { useWeekExpenses } from '@/src/hooks/queries/useWeekExpenses';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { useWeekTimesheet } from '@/src/hooks/queries/useWeekTimesheet';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { formatMoney } from '@/src/lib/money';
import { useIsOnline } from '@/src/lib/network';
import { showSuccessToast } from '@/src/lib/toast';
import { wallClockToUtcIso } from '@/src/lib/wallClock';
import { useAuthStore } from '@/src/store/auth';
import type { TimeEntry } from '../types';
import { formatDuration, formatOvertimeDelta } from '../utils/duration';
import { formatEarningsLongDate } from '../utils/earningsFormat';
import { scheduledMinutesFor, sumEntryMinutes } from '../utils/entryMinutes';
import { derivePaidState, deriveReopenedPaidState } from '../utils/paidState';
import { useReopenedNotice } from '../utils/reopenedNotice';
import { describeTimeEntryWriteError } from '../utils/timeEntryWriteError';
import { DEFAULT_WEEK_STARTS_ON } from '../utils/week';
import { weekClosedReceipt } from '../utils/weekClosed';
import { EarningsBreakdownSheet } from './EarningsBreakdownSheet';
import { HoursHeroBand } from './HoursHeroBand';
import { HoursWeekSkeleton } from './HoursWeekSkeleton';
import { PaymentDetailSheet } from './PaymentDetailSheet';
import { PaymentsEntryRow } from './PaymentsEntryRow';
import { QueryNoteSheet } from './QueryNoteSheet';
import { TimeEntryDayRow } from './TimeEntryDayRow';
import { VoidEntryDialog } from './VoidEntryDialog';
import { WeekExportAction } from './WeekExportAction';
import { WeekMoneyCard } from './WeekMoneyCard';
import { WeekQueryThread } from './WeekQueryThread';
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
  /** Same fact as `readOnly` for a carer today, named for what the hero
   * band says about it ("your record stays here") rather than for what it
   * hides. */
  isPastMember?: boolean;
  /** Bumped by `HoursScreen` each time it consumes a `breakdown=1` deep
   * link (a payment's "For the week" row). A nonce, not a boolean: a SECOND
   * payment opened later must re-open the breakdown, and a flag already
   * sitting at `true` would swallow that. */
  openBreakdownSignal?: number;
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
  isPastMember = false,
  openBreakdownSignal = 0,
}: NannyWeekViewProps) {
  const { t } = useTranslation('hours');
  const { t: tExpenses } = useTranslation('expenses');
  const { t: tErrors } = useTranslation('errors');
  const { t: tSchedule } = useTranslation('schedule');
  const router = useRouter();
  // Same tab-bar dead-zone fix as Settings (BUG1) — the Hours tab's
  // FlashList needs the same real clearance a fixed magic number can't give.
  const tabBarScrollPadding = useTabBarScrollPadding();
  const { refreshing, onRefresh } = usePullToRefresh();
  const currentUserId = useAuthStore(s => s.user?.id ?? null);
  // Daylight P0-5: the household name for the approved appreciation line
  // ("Approved by the Smiths on..."). Reads the same SINGLE CHOKE POINT
  // `HoursScreen` already resolved `householdId` from — a cache hit, not a
  // second request — rather than threading a new prop through a file this
  // task doesn't own.
  const activeHousehold = useActiveHousehold();
  const entriesQuery = useWeekTimeEntries(householdId, weekStartISO);
  const timesheetQuery = useWeekTimesheet(householdId, weekStartISO);
  // Inclusive weekDates[0]..weekDates[6] as a [from, to) instant range —
  // `useShiftsRange` 400s on a plain YYYY-MM-DD.
  const weekFromDate = weekDates[0] ?? weekStartISO;
  const weekLastDate = weekDates[6] ?? weekFromDate;
  const shiftsQuery = useShiftsRange(
    householdId,
    wallClockToUtcIso(weekFromDate, '00:00', timeZone),
    wallClockToUtcIso(addLocalDays(weekLastDate, 1), '00:00', timeZone)
  );
  const expensesQuery = useWeekExpenses(householdId, weekStartISO);
  const settlementsQuery = useReimbursementSettlements(
    householdId,
    weekStartISO
  );
  // Her own arrangement — only read here for the add sheet's mileage-rate
  // hint (TIER0-CX-SPEC.md §6.1); the money line above already covers the
  // rest of what an arrangement is for.
  const arrangementQuery = useCurrentPayArrangement(householdId, currentUserId);
  // Only so a payment's "Recorded by" reads as a person. Resolved through
  // `resolveMemberDisplayName`, same as `ParentWeekView` AND `PaymentsScreen`
  // — all three feed `PaymentDetailSheet`'s `recordedByName`, which degrades
  // an unresolvable id to "Someone", never a hand-rolled "No longer in this
  // household" claim that could be false about a present, active parent on
  // the one field that exists purely for trust. `PaymentsScreen` used to
  // disagree with this (its own lookup, its own fallback string) — fixed to
  // route through the same resolver so the same fact reads the same way
  // everywhere it's shown.
  const membersQuery = useHouseholdMembers(householdId);
  const updateEntry = useUpdateTimeEntry();
  const voidEntry = useVoidTimeEntry();
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
  const [isVoidConfirmOpen, setIsVoidConfirmOpen] = useState(false);
  // The week the breakdown is open FOR, not a bare boolean. Paging to
  // another week then closes it for free — no reset effect to get wrong, and
  // no sheet re-appearing on a week the user paged to.
  const [breakdownWeek, setBreakdownWeek] = useState<string | null>(null);
  const isBreakdownVisible = breakdownWeek === weekStartISO;

  // Landing from a payment's "For the week" row: open the breakdown this
  // view already owns, so the route is one hop rather than two. Deliberately
  // NOT keyed on `weekStartISO` — re-running on a week change would re-open
  // the sheet on whatever week the user paged to next.
  //
  // Nothing here forces a sheet to exist. `EarningsBreakdownSheet` only
  // mounts under `earningsOk`, so a `no_arrangement` or hours-only week
  // lands on the week and opens nothing — an empty breakdown would be worse
  // than none. Earnings that resolve a moment AFTER landing do open it,
  // which is exactly the first-paint case.
  // biome-ignore lint/correctness/useExhaustiveDependencies: weekStartISO is READ at signal time, never tracked — listing it re-runs this on every page and re-opens the sheet on the week the user moved to.
  useEffect(() => {
    if (!openBreakdownSignal) return;
    setBreakdownWeek(weekStartISO);
  }, [openBreakdownSignal]);
  // The ID, not the payment — a refetch re-resolves the open sheet against
  // fresh data. Same discipline as `PaymentsScreen`.
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(
    null
  );
  const [isAddExpenseVisible, setIsAddExpenseVisible] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  // §3.1. Null means closed; the object carries the sentence her message is
  // prefixed with — empty from the week, and the payment's date and amount
  // from a payment row, so the record says WHICH payment she meant.
  const [flagSheet, setFlagSheet] = useState<{ prefix: string } | null>(null);
  // She opened a thread on an approved week: §3's read-only rule relaxes
  // exactly this far and the composer comes back for the conversation that
  // resulted. Session-scoped on purpose — it is a fact about this visit, not
  // about the week.
  const [composerReopened, setComposerReopened] = useState(false);
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
  // Read-only for her. Fetch once approved OR reopened — the ledger survives
  // a reopen even when the earnings snapshot clears.
  const showSettlementHistory =
    timesheet?.status === 'approved' || timesheet?.reopen_reason != null;
  const paymentsQuery = usePayments(
    showSettlementHistory && timesheet ? timesheet.id : null
  );
  // §3 — fetched for every week, not only queried ones: the thread outlives
  // the query, and it renders NOTHING when empty.
  const threadQuery = useTimesheetThread(timesheet?.id ?? null);
  const addThreadMessage = useAddTimesheetThreadMessage();

  // Confirmation is the message appearing in the thread with her name and a
  // timestamp — no toast, no "your dispute has been filed" (§3.1).
  const handleSendThreadMessage = (message: string) => {
    if (!timesheet) return;
    addThreadMessage.mutate({ timesheetId: timesheet.id, message });
  };

  /**
   * §3.1's send. Closes only on success, so a refusal leaves what she typed
   * in place, and reopens the inline composer so the conversation she just
   * started has somewhere to continue — including on an approved week.
   */
  const handleSubmitFlag = (note: string) => {
    if (!timesheet || !flagSheet) return;
    addThreadMessage
      .mutateAsync({
        timesheetId: timesheet.id,
        message: `${flagSheet.prefix}${note}`,
      })
      .then(() => {
        setFlagSheet(null);
        setComposerReopened(true);
      })
      .catch(() => undefined);
  };

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
    setIsVoidConfirmOpen(false);
    setEditing(entry);
  };
  const closeEditor = () => {
    setSaveRefusal(null);
    setIsVoidConfirmOpen(false);
    setEditing(null);
  };

  /**
   * Withdraw an entry that should never have existed. The refusal lands in
   * the SAME inline slot a failed correction uses — a toast fired over an
   * open BottomSheetBase is not visible on iOS (GOLDEN-FIXES #40). The sheet
   * stays open on failure so she can see why.
   */
  const handleVoid = () => {
    if (!editing) return;
    setSaveRefusal(null);
    setIsVoidConfirmOpen(false);
    voidEntry
      .mutateAsync({ entryId: editing.id })
      .then(() => {
        closeEditor();
        showSuccessToast(t('entryRemovedToast'));
      })
      .catch((error: unknown) => {
        setSaveRefusal(
          describeTimeEntryWriteError(error, tErrors, timeZone, isOnline)
        );
      });
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
      .then(() => {
        closeEditor();
        showSuccessToast(t('entryCorrectedToast'));
      })
      .catch((error: unknown) => {
        setSaveRefusal(
          describeTimeEntryWriteError(error, tErrors, timeZone, isOnline)
        );
      });
  };

  // The hero band's title and week label paint now; only the figure and the
  // day rows wait (screens-hours.md §7 — never a full-screen spinner).
  if (entriesQuery.isLoading) {
    return (
      <View
        style={{
          ...SCREEN_CONTENT_STYLE,
          paddingBottom: tabBarScrollPadding,
        }}
      >
        <HoursWeekSkeleton
          weekRangeLabel={weekRangeLabel}
          onPreviousWeek={onPreviousWeek}
          onNextWeek={onNextWeek}
          isPreviousDisabled={isPreviousWeekDisabled}
          isNextDisabled={isNextWeekDisabled}
        />
      </View>
    );
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
  const showWeekClosedReceipt = weekClosedReceipt({
    shifts: shiftsQuery.data ?? [],
    carerId: currentUserId,
    nowMs,
    totalMinutes,
    status: timesheet?.status ?? null,
    weekDates,
    timeZone,
  });
  const weekHoursLabel =
    entries.length > 0 && totalMinutes === 0
      ? formatDuration(60).replace('1', '0')
      : formatDuration(totalMinutes);
  const scheduledMinutes = scheduledMinutesFor(entries);
  const overtimeLabel = formatOvertimeDelta(totalMinutes, scheduledMinutes);
  const todayISO = localDateInZone(timeZone, new Date(nowMs));
  const weekStartsOn =
    activeHousehold.household?.week_starts_on ?? DEFAULT_WEEK_STARTS_ON;
  const dayMinutes = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < weekDates.length; i++) {
    const date = weekDates[i];
    if (!date) continue;
    dayMinutes[(weekStartsOn + i) % 7] = sumEntryMinutes(
      entries.filter(entry => entry.local_date === date),
      nowMs
    );
  }
  const todayOffset = weekDates.indexOf(todayISO);
  const todayIndex =
    todayOffset === -1 ? null : (weekStartsOn + todayOffset) % 7;
  const lead = t('lead.nanny', {
    hours: weekHoursLabel,
    family: activeHousehold.household?.name ?? '',
  });

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
  const parentViewedDateLabel = timesheet?.parent_viewed_at
    ? formatEarningsLongDate(
        localDateInZone(timeZone, new Date(timesheet.parent_viewed_at))
      )
    : null;

  // TIER0-CX-SPEC.md §6.3/§7: the Reimbursements card is approved-only and
  // shares the week's currency — `earningsOk.currency` when a timesheet
  // exists, else her own arrangement's currency, else the house default.
  const weekExpenses = expensesQuery.data ?? [];
  const approvedExpenses = weekExpenses.filter(e => e.status === 'approved');
  // D-B1: a failed or still-in-flight settlement read must never render
  // "not reimbursed yet" over money that may already be back with her
  // (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B's compound finding) — worse
  // for her than the parent's side, since she has no button whose absence
  // would reveal the contradiction.
  const settlementsUnknown =
    settlementsQuery.isError || settlementsQuery.isPending;
  const reimbursementSettlement =
    !settlementsUnknown && currentUserId != null
      ? (settlementsQuery.data?.find(s => s.carer_id === currentUserId) ?? null)
      : null;
  const reimbursementSettledOn = reimbursementSettlement?.settled_at ?? null;
  const reimbursementSettledAmountMinor =
    reimbursementSettlement?.amount_minor ?? null;
  const expensesCurrency =
    earningsOk?.currency ??
    arrangementQuery.data?.currency ??
    activeHousehold.household?.currency ??
    'USD';
  // `earningsOk` is null for a week with no server total — `derivePaidState`
  // returns null for that rather than measuring against a fabricated zero
  // (docs/11-MONEY.md §4), and the card then renders nothing.
  // D-B1: same discipline as `settlementsUnknown` above — a failed or
  // still-in-flight ledger read must never render "Unpaid" over a week that
  // may already be settled.
  const paymentsUnknown =
    showSettlementHistory && (paymentsQuery.isError || paymentsQuery.isPending);
  const payments: Payment[] = paymentsUnknown ? [] : (paymentsQuery.data ?? []);
  const paidState = paymentsUnknown
    ? null
    : earningsOk
      ? derivePaidState(payments, earningsOk.gross_minor)
      : timesheet?.reopen_reason != null
        ? deriveReopenedPaidState(payments)
        : null;
  const settlementCurrency =
    earningsOk?.currency ??
    payments[0]?.currency ??
    arrangementQuery.data?.currency ??
    activeHousehold.household?.currency ??
    'USD';
  const mileageRateMinor =
    arrangementQuery.data?.mileage_rate_per_mile_minor ?? null;
  const selectedPayment =
    payments.find(payment => payment.id === selectedPaymentId) ?? null;
  const membersByUserId = new Map(
    (membersQuery.data ?? []).map(member => [member.user_id, member])
  );
  const memberLabels = {
    you: tSchedule('detail.you'),
    someone: tSchedule('detail.someone'),
    roleFallback: (role: 'owner' | 'parent' | 'nanny' | 'helper') =>
      tSchedule(`detail.roleFallback.${role}`),
  };

  return (
    <>
      <FlashList
        testID="hours-week-list"
        data={dayRows}
        refreshing={refreshing}
        onRefresh={onRefresh}
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
          <>
            <HoursHeroBand
              weekRangeLabel={weekRangeLabel}
              onPreviousWeek={onPreviousWeek}
              onNextWeek={onNextWeek}
              isNextDisabled={isNextWeekDisabled}
              isPreviousDisabled={isPreviousWeekDisabled}
              totalLabel={weekHoursLabel}
              overtimeLabel={overtimeLabel}
              isPastMember={isPastMember}
              dayMinutes={dayMinutes}
              scheduledMinutes={scheduledMinutes}
              weekStartsOn={weekStartsOn}
              todayIndex={todayIndex}
              lead={lead}
            />
            <WeekTotal
              testID="hours-week-total"
              timesheetStatus={timesheet?.status ?? null}
              earnings={earnings}
              earningsRole="nanny"
              approvedDateLabel={approvedDateLabel}
              parentViewedDateLabel={parentViewedDateLabel}
              householdName={activeHousehold.household?.name ?? null}
              earningsReopened={reopened}
              earningsReopenReason={timesheet?.reopen_reason ?? null}
              // 102: hours she added after the week was paid. Same caption
              // slot as the parent's, worded from her side — the family can
              // already see them, and nothing else on this screen says so.
              hoursChangedAfterPaymentNote={
                timesheet?.hours_changed_after_payment_at
                  ? t('paidWeek.hoursAddedNanny')
                  : null
              }
            />
            {showWeekClosedReceipt ? (
              <ReceiptCard
                testID="hours-week-closed-receipt"
                receiptKey={`weekClosed:${householdId}:${weekStartISO}`}
                title={t('receipts.weekClosed.title', {
                  hours: weekHoursLabel,
                })}
                body={t('receipts.weekClosed.body', {
                  household: activeHousehold.household?.name ?? '',
                })}
              />
            ) : null}
            <WeekQueryThread
              messages={threadQuery.data?.messages ?? []}
              currentUserId={currentUserId}
              timeZone={timeZone}
              timesheetStatus={timesheet?.status ?? null}
              viewerRole="nanny"
              composerReopened={composerReopened}
              onSend={handleSendThreadMessage}
              isSending={addThreadMessage.isPending}
              sendError={
                addThreadMessage.error
                  ? getLocalizedErrorMessage(addThreadMessage.error, tErrors)
                  : null
              }
            />
          </>
        }
        ListFooterComponent={
          <>
            {/* §7 fixed order item 4 — the money card sits under the day
                rows it totals: gross, breakdown link and paid state, one
                card (screens-hours.md §5). */}
            <WeekMoneyCard
              earnings={earnings ?? null}
              timesheetStatus={timesheet?.status ?? null}
              viewerRole="nanny"
              carerId={timesheet?.carer_id ?? null}
              carerDisplayName={timesheet?.carer_display_name ?? ''}
              totalMinutes={totalMinutes}
              earningsError={timesheetQuery.isError}
              onRetryEarnings={() => void timesheetQuery.refetch()}
              onPressBreakdown={() => setBreakdownWeek(weekStartISO)}
              nothingUnusual={timesheet?.nothing_unusual ?? null}
              // "Paid £X on <date>", and what is still owed. No
              // `onMarkPaidPress` — recording a payment is the paying
              // family's action, and its absence is the whole read-only
              // contract (see PaidStateSection's module doc).
              paidState={showSettlementHistory ? paidState : null}
              payments={payments}
              settlementCurrency={settlementCurrency}
              paidStateUnknown={paymentsUnknown}
              onRetryPayments={() => void paymentsQuery.refetch()}
              onPaymentPress={payment => setSelectedPaymentId(payment.id)}
            />
            {/* §3.1 (M12): the one place a nanny can say a figure is wrong
                without waiting to be asked. On a `submitted` or `approved`
                week only — a `queried` week already has the composer open,
                and an `open` week is still hers to correct directly. */}
            {!readOnly && (timesheet?.status === 'submitted' || isApproved) ? (
              <Pressable
                testID="hours-flag-link"
                accessibilityRole="button"
                onPress={() => setFlagSheet({ prefix: '' })}
                className="mb-4 self-start py-2"
              >
                <Body className="text-primary">{t('thread.flagLink')}</Body>
              </Pressable>
            ) : null}
            {/* §7 fixed order item 3 — after day rows, approved-only,
                never rendered when the week has no approved claims. */}
            <ReimbursementsCard
              approvedExpenses={approvedExpenses}
              totalMinor={earningsOk ? earningsOk.reimbursements_minor : null}
              currency={expensesCurrency}
              settledOn={reimbursementSettledOn}
              settledAmountMinor={reimbursementSettledAmountMinor}
              settlementUnknown={settlementsUnknown}
              onRetrySettlements={() => void settlementsQuery.refetch()}
            />
            {/* Daylight P1: "Add an expense" is now ExpensesListCard's own
                footer action (it used to float here on a bare mt-4,
                belonging to neither card) — same readOnly gate as
                onEdit/onWithdraw below. */}
            <ExpensesListCard
              expenses={weekExpenses}
              onEdit={readOnly ? undefined : handleEditExpense}
              onWithdraw={readOnly ? undefined : handleWithdrawExpense}
              onAddExpense={readOnly ? undefined : handleOpenAddExpense}
            />
            {/* Cross-week record, not gated on this week's approval — same
                read-only entitlement as the money card above it. */}
            <PaymentsEntryRow
              subtitle={t('payments.subtitleNanny')}
              onPress={() => router.push('/(private)/payments' as Href)}
            />
            {showSettlementHistory && timesheet && isApproved ? (
              <WeekExportAction
                timesheetId={timesheet.id}
                weekStartISO={weekStartISO}
                weekRangeLabel={weekRangeLabel}
                carerName={timesheet.carer_display_name}
                earnings={earningsOk}
                paidState={paidState}
              />
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
      {/* HIDE the sheet while the confirm is up. `VoidEntryDialog` renders
          through the root PortalHost — the JS tree — while BottomSheetBase is
          an RN <Modal>, a native window ABOVE that tree, so a dialog shown
          over an open sheet is invisible (GOLDEN-FIXES #40's family: it is
          not only toasts). `editing` stays set, so cancelling brings the
          sheet straight back. */}
      <ClockOutSheet
        visible={editing !== null && !isVoidConfirmOpen}
        onDismiss={closeEditor}
        onSubmit={handleSaveCorrection}
        isSubmitting={updateEntry.isPending || voidEntry.isPending}
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
        // Only an unapproved week is hers to withdraw from; an approved one
        // is a signed agreement and the server refuses it anyway, so the
        // affordance is withheld rather than shown-and-refused.
        onVoidPress={isApproved ? null : () => setIsVoidConfirmOpen(true)}
        voidLabel={t('voidEntry')}
      />

      {/* Outside the list with the other sheets. `weekStart` is null on
          purpose — the week is the context this was opened from, and
          `paidToName` is null because it is always her. */}
      <PaymentDetailSheet
        visible={selectedPayment !== null}
        onDismiss={() => setSelectedPaymentId(null)}
        payment={selectedPayment}
        weekStart={null}
        paidToName={null}
        recordedByName={resolveMemberDisplayName(
          selectedPayment?.recorded_by ?? null,
          currentUserId,
          membersByUserId,
          memberLabels
        )}
        // §3.1's second placement. The payment sheet CLOSES first: the flag
        // composer is another BottomSheetBase, and a sheet opened over a
        // sheet is invisible on iOS (GOLDEN-FIXES #40's family). The prefix
        // stamps the payment's date and amount into her message so the
        // record says which payment she meant.
        onFlagPress={
          readOnly
            ? undefined
            : payment => {
                setSelectedPaymentId(null);
                setFlagSheet({
                  prefix: t('thread.flagPaymentPrefix', {
                    amount: formatMoney(payment.amount_minor, payment.currency),
                    date: formatEarningsLongDate(payment.paid_at),
                  }),
                });
              }
        }
      />

      {/* The same one-note composer the parent's Query uses — same shape,
          same act, one keyboard behaviour to keep right. */}
      <QueryNoteSheet
        sheetId="hours-flag"
        testID="hours-flag-sheet"
        visible={flagSheet !== null}
        onDismiss={() => setFlagSheet(null)}
        onSubmit={handleSubmitFlag}
        isSubmitting={addThreadMessage.isPending}
        title={t('thread.flagTitle')}
        hint={t('thread.flagHint')}
        placeholder={t('thread.flagPlaceholder')}
        submitLabel={t('thread.flagSubmit')}
        submitError={
          addThreadMessage.error
            ? getLocalizedErrorMessage(addThreadMessage.error, tErrors)
            : null
        }
      />

      <VoidEntryDialog
        open={isVoidConfirmOpen}
        onOpenChange={setIsVoidConfirmOpen}
        onConfirm={handleVoid}
        isSubmitting={voidEntry.isPending}
      />

      {earningsOk ? (
        <EarningsBreakdownSheet
          visible={isBreakdownVisible}
          onDismiss={() => setBreakdownWeek(null)}
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
