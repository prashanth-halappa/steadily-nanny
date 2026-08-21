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
 * Daylight P0-3: Approve, Query, Reopen and the "waiting" explainer all
 * render INSIDE `WeekTotal` (`primaryAction`/`secondaryAction`/
 * `tertiaryAction`/`onReopenPress`/`actionsNote`), not this component's
 * FlashList footer — they used to sit below every day row and the
 * reimbursements card, several screens down from the figure they act on.
 * This component still owns every handler, dialog and gate (`isActionable`,
 * `readOnly`); `WeekTotal` stays presentational. See that module's doc
 * comment for the card's full vertical order.
 *
 * 3-T1 (`docs/design/attention-and-notifications.md` §3): the week's
 * conversation is `WeekQueryThread`, mounted directly under `WeekTotal`, and
 * the parent's exit from `queried` is "Withdraw the query" in the card's
 * tertiary slot behind `WithdrawQueryDialog`. The promoted parent-only
 * `query_note` band is gone — the thread renders that first message to both
 * sides, which is the whole of P1.
 *
 * 3-T2 (`docs/design/attention-and-notifications.md` §4.1): "Correct this
 * payment" is wired HERE and nowhere else. It hangs off `PaymentDetailSheet`'s
 * `onCorrectPress`, which only this view passes — correcting is the PAYER's
 * act, so the nanny's view and the read-only `PaymentsScreen` simply never
 * receive the prop, and there is no role check inside either component.
 *
 * TIER0-CX-SPEC.md §6.2/§6.3/§7 (Phase 4, additive): the footer also carries
 * the pending-expenses review affordance (action-gated behind `!readOnly`,
 * same as approve/query — a helper sees the statement but never reviews)
 * and, per §7's fixed order (item 3), the read-only Reimbursements card —
 * visible to a helper too, since it is informational, not an action.
 */

import { FlashList } from '@shopify/flash-list';
import type {
  CreatePaymentCorrectionInput,
  CreatePaymentInput,
  Payment,
} from '@steadily-nanny/shared-types/schemas/payment.schema';
import type { PreviousApproval } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import * as Crypto from 'expo-crypto';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/src/components/custom/ErrorState';
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
import { useAddTimesheetThreadMessage } from '@/src/hooks/mutations/useAddTimesheetThreadMessage';
import { useApproveTimesheet } from '@/src/hooks/mutations/useApproveTimesheet';
import {
  correctionRefusalMetadata,
  useCorrectPayment,
} from '@/src/hooks/mutations/useCorrectPayment';
import { useMarkReimbursed } from '@/src/hooks/mutations/useMarkReimbursed';
import { useMarkTimesheetViewed } from '@/src/hooks/mutations/useMarkTimesheetViewed';
import { useQueryTimesheet } from '@/src/hooks/mutations/useQueryTimesheet';
import {
  type OverPaymentMetadata,
  overPaymentMetadata,
  useRecordPayment,
} from '@/src/hooks/mutations/useRecordPayment';
import {
  isPaidWeekReopenRefusal,
  useReopenTimesheet,
} from '@/src/hooks/mutations/useReopenTimesheet';
import { useReviewExpense } from '@/src/hooks/mutations/useReviewExpense';
import { useWithdrawTimesheetQuery } from '@/src/hooks/mutations/useWithdrawTimesheetQuery';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { usePayments } from '@/src/hooks/queries/usePayments';
import { usePendingExpenses } from '@/src/hooks/queries/usePendingExpenses';
import { useReimbursementSettlements } from '@/src/hooks/queries/useReimbursementSettlements';
import { useTimesheetThread } from '@/src/hooks/queries/useTimesheetThread';
import { useWeekExpenses } from '@/src/hooks/queries/useWeekExpenses';
import { useWeekPayDueDate } from '@/src/hooks/queries/useWeekPayDueDate';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { useWeekTimesheet } from '@/src/hooks/queries/useWeekTimesheet';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { localDateInZone } from '@/src/lib/localDate';
import { formatMoney } from '@/src/lib/money';
import { showSuccessToast } from '@/src/lib/toast';
import { useAuthStore } from '@/src/store/auth';
import type { WeekEarningsOk, WeekEarningsStateResult } from '../types';
import { TIMESHEET_STATUSES } from '../types';
import { carerKeyOf } from '../utils/carerKey';
import { formatDuration, formatOvertimeDelta } from '../utils/duration';
import {
  earningsStructureLine,
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
import { DEFAULT_WEEK_STARTS_ON } from '../utils/week';
import { ApproveWeekDialog } from './ApproveWeekDialog';
import { EarningsBreakdownSheet } from './EarningsBreakdownSheet';
import { HoursHeroBand } from './HoursHeroBand';
import { HoursWeekSkeleton } from './HoursWeekSkeleton';
import {
  type PaymentCorrectionRefusal,
  PaymentCorrectionSheet,
} from './PaymentCorrectionSheet';
import { PaymentDetailSheet } from './PaymentDetailSheet';
import { PaymentsEntryRow } from './PaymentsEntryRow';
import { QueryNoteSheet } from './QueryNoteSheet';
import { RecordPaymentSheet } from './RecordPaymentSheet';
import { ReopenWeekDialog } from './ReopenWeekDialog';
import { TimeEntryDayRow } from './TimeEntryDayRow';
import {
  type StagedAdjustment,
  WeekAdjustmentSheet,
} from './WeekAdjustmentSheet';
import { WeekExportAction } from './WeekExportAction';
import { WeekMoneyCard } from './WeekMoneyCard';
import { WeekQueryThread } from './WeekQueryThread';
import { WeekTotal } from './WeekTotal';
import { WithdrawQueryDialog } from './WithdrawQueryDialog';

/** Session-scoped one-shot so a remount does not re-stamp. Keyed per
 * viewer and per timesheet — a two-carer week has two rows. */
const viewedThisSession = new Set<string>();

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
  /** Removed from this household. Distinct from `readOnly`, which is also
   * true for a helper who is still a member: only a past member gets the
   * "your record stays here" line under the hero band. */
  isPastMember?: boolean;
  /** Bumped by `HoursScreen` each time it consumes a `breakdown=1` deep
   * link (a payment's "For the week" row). A nonce, not a boolean: a SECOND
   * payment opened later must re-open the breakdown, and a flag already
   * sitting at `true` would swallow that. */
  openBreakdownSignal?: number;
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
  isPastMember = false,
  openBreakdownSignal = 0,
}: ParentWeekViewProps) {
  const { t } = useTranslation('hours');
  const { t: tSchedule } = useTranslation('schedule');
  const { t: tExpenses } = useTranslation('expenses');
  const { t: tErrors } = useTranslation('errors');
  const router = useRouter();
  // Same tab-bar dead-zone fix as Settings (BUG1) — the Hours tab's
  // FlashList needs the same real clearance a fixed magic number can't give.
  const tabBarScrollPadding = useTabBarScrollPadding();
  const { refreshing, onRefresh } = usePullToRefresh();
  const colors = useThemeColors();
  const currentUserId = useAuthStore(s => s.user?.id ?? null);
  // Cache hit, not a second request — `HoursScreen` already resolved this
  // same household via `useActiveHousehold` to get `householdId`. Only read
  // here for the household-level currency fallback below (same pattern as
  // `NannyWeekView`'s Daylight P0-5 household-name read).
  const activeHousehold = useActiveHousehold();
  // Declared up here with the hooks, not beside its first use below: the
  // due-date hook needs it, and this component early-returns on loading and
  // on error long before that point.
  const weekStartsOn =
    activeHousehold.household?.week_starts_on ?? DEFAULT_WEEK_STARTS_ON;
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
  const correctPayment = useCorrectPayment();
  // D-14: "have we paid her back what she spent". A SEPARATE record from
  // payments — never summed into paid-to-date (see ReimbursementsCard).
  const settlementsQuery = useReimbursementSettlements(
    householdId,
    weekStartISO
  );
  const markReimbursed = useMarkReimbursed();
  const withdrawQuery = useWithdrawTimesheetQuery();
  const markViewed = useMarkTimesheetViewed();
  const addThreadMessage = useAddTimesheetThreadMessage();
  const [isQuerySheetVisible, setIsQuerySheetVisible] = useState(false);
  const [isWithdrawDialogOpen, setIsWithdrawDialogOpen] = useState(false);
  const [isRecordPaymentVisible, setIsRecordPaymentVisible] = useState(false);
  // The ID, not the payment: a refetch then re-resolves the open sheet
  // against fresh data instead of pinning the snapshot that was on screen
  // when it was tapped. Same discipline as `PaymentsScreen`.
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(
    null
  );
  // The server's own over-payment figures, held so the sheet can state the
  // ceiling it hit. Cleared on every open and every fresh attempt — a stale
  // banner would accuse the parent of a mistake they already corrected.
  const [overPayment, setOverPayment] = useState<OverPaymentMetadata | null>(
    null
  );
  // D-20 (attention spec §4.1). The payment ITSELF, not its id: the detail
  // sheet is closed before this one opens, so there is no selected row left
  // to resolve it from — and a correction must go on reading the figure the
  // parent was looking at when they pressed it. Cleared on dismiss.
  const [correctingPayment, setCorrectingPayment] = useState<Payment | null>(
    null
  );
  // The server's own refusal figures, held so the sheet can state the ceiling
  // it hit. Cleared on every open and every fresh attempt — the same reason
  // `overPayment` is.
  const [correctionRefusal, setCorrectionRefusal] =
    useState<PaymentCorrectionRefusal | null>(null);
  // The approval-time adjustment lives ONLY here until approve is sent —
  // Option A stages it client-side rather than persisting it, so nothing
  // exists server-side to reconcile and the nanny is never shown a figure
  // that may still be withdrawn.
  const [pendingAdjustment, setPendingAdjustment] =
    useState<StagedAdjustment | null>(null);
  const [isAdjustmentSheetVisible, setIsAdjustmentSheetVisible] =
    useState(false);
  const [isApproveDialogOpen, setIsApproveDialogOpen] = useState(false);
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  // The paid-week reopen refusal, already localized. Held so the dialog can
  // state it inline; cleared when it opens and on every fresh attempt — the
  // same discipline as `overPayment`.
  const [reopenRefusal, setReopenRefusal] = useState<string | null>(null);
  // ONE payment intent = one uuid, minted when the sheet opens and reused by
  // every retry of that intent. `payments` is append-only with no edit path,
  // so a double-tapped POST or a retry after a response the phone never saw
  // would otherwise file a second real row for money that moved once; the key
  // makes the server hand back the row the first attempt wrote (102).
  const paymentIntentKeyRef = useRef<string | null>(null);
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
  // WP-F: when the pay period this week belongs to falls due — PRESENTATION
  // ONLY, and three-valued (`undefined` means "not known yet"). Keyed to the
  // SELECTED carer's own arrangement, the same one the money card below
  // states a balance for, so a multi-carer household can never read one
  // carer's pay day over another's figures. See the hook's doc.
  const dueDate = useWeekPayDueDate({
    householdId,
    carerId: timesheet?.carer_id,
    weekStartISO,
    weekEndISO: weekDates[weekDates.length - 1] ?? weekStartISO,
    weekStartsOn,
  });
  // False alarm (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B): every caller of
  // `timesheetStatus` below used to pre-coerce `timesheet?.status ?? null`,
  // and `WeekTotal`'s `hasStatus` reads `null` as "genuinely not
  // submitted" — printing a false headline/pill over a week whose real
  // status this component simply failed (or hasn't yet managed) to read.
  // `undefined` is what keeps that distinction alive downstream.
  const timesheetStatusForDisplay =
    timesheetQuery.isPending || timesheetQuery.isError
      ? undefined
      : (timesheet?.status ?? null);
  useEffect(() => {
    if (!timesheet || !currentUserId) return;
    if (isPastMember) return;
    if (
      timesheet.status !== TIMESHEET_STATUSES.SUBMITTED &&
      timesheet.status !== TIMESHEET_STATUSES.QUERIED
    ) {
      return;
    }
    if (timesheet.parent_viewed_at) return;
    const key = `${currentUserId}:${timesheet.id}`;
    if (viewedThisSession.has(key)) return;
    viewedThisSession.add(key);
    markViewed.mutate({
      timesheetId: timesheet.id,
      householdId,
      weekStart: weekStartISO,
    });
  }, [
    timesheet,
    currentUserId,
    isPastMember,
    markViewed,
    householdId,
    weekStartISO,
  ]);
  const reopened = useReopenedNotice(timesheet?.id, timesheet?.status);
  // Drop the staged adjustment whenever the week underneath it moves — a
  // different carer's row, or a roll-up that changed the hours. The parent
  // decided "-£20" against a gross that no longer exists, and carrying that
  // number forward would attach it to a total she never saw.
  const timesheetId = timesheet?.id ?? null;
  const timesheetUpdatedAt = timesheet?.updated_at ?? null;
  useEffect(() => {
    // Both dependencies are READ here, not merely listed: `bun run format`'s
    // unsafe pass deletes a dependency the body never touches, and this
    // effect exists precisely to fire when either changes (GOLDEN-FIXES #30).
    if (timesheetId === null && timesheetUpdatedAt === null) return;
    setPendingAdjustment(null);
  }, [timesheetId, timesheetUpdatedAt]);
  // Settlement is measured against a frozen gross, but a reopened week keeps
  // its ledger rows even after the snapshot clears — fetch whenever the week
  // is approved OR carries a reopen reason (submitted-with-reopen_reason).
  const showSettlementHistory =
    timesheet?.status === TIMESHEET_STATUSES.APPROVED ||
    timesheet?.reopen_reason != null;
  const paymentsQuery = usePayments(
    showSettlementHistory && timesheet ? timesheet.id : null
  );
  // §3 — what was SAID about this week. Fetched for every week, not only
  // queried ones: the thread outlives the query (a withdrawal, a reply on an
  // approved week) and it renders NOTHING when empty, so the ~50 clean weeks
  // a year still look exactly as they do today.
  const threadQuery = useTimesheetThread(timesheet?.id ?? null);

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

  // The hero band's title and week label paint now; only the figure and the
  // day rows wait (screens-hours.md §7 — never a full-screen spinner).
  if (entriesQuery.isLoading || timesheetQuery.isLoading) {
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
  const weekHoursLabel = formatDuration(totalMinutes);
  const scheduledMinutes = scheduledMinutesFor(entries);
  const overtimeLabel = formatOvertimeDelta(totalMinutes, scheduledMinutes);
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
  // Withdraw is the mirror of query: valid ONLY from `queried`, and the API
  // refuses it anywhere else, so the affordance is withheld rather than
  // shown-and-refused (same discipline as `onVoidPress` on an approved week).
  const isQueried = timesheet?.status === TIMESHEET_STATUSES.QUERIED;

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
  // P6b: `parent_viewed_at` used to feed only the NANNY's status timeline —
  // the parent who actually opened the week never saw any acknowledgment
  // of their own read. Same zone-aware date shape as `approvedDateLabel`.
  const parentViewedNote = timesheet?.parent_viewed_at
    ? t('parentViewedNote', {
        date: formatEarningsLongDate(
          localDateInZone(timeZone, new Date(timesheet.parent_viewed_at))
        ),
      })
    : null;
  // The dialog confirms the figure that will actually be FROZEN, so the
  // staged adjustment is folded in here rather than mentioned beside an
  // un-adjusted total. `adjustmentLabel` is absolute — the body copy's verb
  // ("adding" / "taking off") carries the sign.
  const stagedAdjustment = earningsOk ? pendingAdjustment : null;
  const grossLabel = earningsOk
    ? formatMoney(
        earningsOk.gross_minor + (stagedAdjustment?.amount_minor ?? 0),
        earningsOk.currency
      )
    : null;
  const adjustmentLabel =
    earningsOk && stagedAdjustment
      ? formatMoney(
          Math.abs(stagedAdjustment.amount_minor),
          earningsOk.currency
        )
      : null;
  const adjustmentDirection = stagedAdjustment
    ? stagedAdjustment.amount_minor < 0
      ? ('deducted' as const)
      : ('added' as const)
    : null;
  const approveDialogCarerName =
    carerName ?? timesheet?.carer_display_name ?? tSchedule('detail.someone');

  // D79 — THE WEEK CHANGED AFTER IT WAS APPROVED. Two shapes, one block on
  // `WeekTotal`, and the fork is whether money had already moved:
  //
  //  A. PAID (102). `hours_changed_after_payment_at` set, status still
  //     `approved`. `earnings` is the FROZEN snapshot the payments were
  //     bounded by; `revised_earnings` is what the week would come to now.
  //  B. UNPAID (111). The roll-up demoted it to `submitted` and copied the
  //     approval it destroyed into `previous_approval`. `earnings` is LIVE.
  //
  // Shape B is gated on `!reopen_reason` on purpose: a MANUAL reopen also
  // writes `previous_approval`, but it was never silent — the parent did it
  // and typed a reason, and `WeekTotal` already renders that reason. This
  // block is for the demotion nobody performed. The manual reopen's receipt
  // still earns its keep in `ApproveWeekDialog`'s supersedes line below.
  const previousApproval = timesheet?.previous_approval ?? null;
  const flaggedAt = timesheet?.hours_changed_after_payment_at ?? null;
  const isShapePaid = isApproved && !!flaggedAt;
  const isShapeDemoted =
    !isApproved && !!previousApproval && !timesheet?.reopen_reason;
  // Which day changed — free, and carries no money. The entries this view
  // already holds, filtered to those written after the week was settled; the
  // most recent one is the day to name. Falls back to the settlement stamp
  // itself when nothing matches (a VOID is an update, not an insert, so it
  // moves no `created_at`).
  const changedSince = isShapePaid
    ? flaggedAt
    : (previousApproval?.approved_at ?? null);
  const changedDateLabel = changedSince
    ? formatEarningsLongDate(
        // `Date.parse`, not a string comparison: `created_at` arrives from
        // PostgREST as "+00:00" while `previous_approval.approved_at` is
        // whatever `jsonb_build_object` produced and the flag column is
        // whatever wrote it. Same instant, three spellings — comparing the
        // strings would sort them by suffix.
        entries
          .filter(e => Date.parse(e.created_at) > Date.parse(changedSince))
          .map(e => e.local_date)
          .sort()
          .at(-1) ?? localDateInZone(timeZone, new Date(changedSince))
      )
    : null;
  const weekChanged = isShapePaid
    ? buildPaidWeekChanged({
        t,
        name: approveDialogCarerName,
        date: changedDateLabel,
        frozen: earningsOk,
        revised: timesheet?.revised_earnings ?? null,
      })
    : isShapeDemoted && previousApproval
      ? buildDemotedWeekChanged({
          t,
          name: approveDialogCarerName,
          date: changedDateLabel,
          approvedDate: formatEarningsLongDate(
            localDateInZone(timeZone, new Date(previousApproval.approved_at))
          ),
          previous: previousApproval,
          live: earningsOk,
        })
      : null;
  // The supersedes line renders for BOTH ways an approval was lost, manual
  // reopen included — approving again replaces a figure that really existed,
  // and the parent should be told which one.
  const supersedesLine =
    !isApproved &&
    previousApproval &&
    previousApproval.gross_minor !== null &&
    previousApproval.currency !== null
      ? t('approveDialog.supersedes', {
          amount: formatMoney(
            previousApproval.gross_minor,
            previousApproval.currency
          ),
          date: formatEarningsLongDate(
            localDateInZone(timeZone, new Date(previousApproval.approved_at))
          ),
        })
      : null;

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
    earningsOk?.currency ??
    approvedExpenses[0]?.currency ??
    activeHousehold.household?.currency ??
    'USD';

  // TIER0 settlement (067): the ledger measured against the FROZEN gross.
  // `earningsOk` is null for a week with no server total, and `derivePaidState`
  // returns null for that — never `?? 0`, which would render "Paid" over a
  // week whose value is simply unknown (docs/11-MONEY.md §4).
  // D-B1: a failed OR still-in-flight ledger read must never render as
  // "Unpaid" over a settled week (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B's
  // compound finding) — `showSettlementHistory` is `usePayments`'s own
  // `enabled` gate, so this stays false (not "unknown forever") on a week
  // with no settlement to fetch at all.
  const paymentsUnknown =
    showSettlementHistory && (paymentsQuery.isError || paymentsQuery.isPending);
  const payments: Payment[] = paymentsUnknown ? [] : (paymentsQuery.data ?? []);
  const selectedPayment =
    payments.find(payment => payment.id === selectedPaymentId) ?? null;
  const paidState = paymentsUnknown
    ? null
    : earningsOk
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
  const lead = carerName
    ? t('lead.parent', {
        name: carerName,
        hours: weekHoursLabel,
      })
    : t('lead.parentNoCarer', {
        hours: weekHoursLabel,
      });

  // The settlement is filed against the carer's REAL id, not the bucket key
  // `carerKeyOf` returns — a departed carer (`carer_id` NULL) has no id to
  // file against, so the action is simply not offered for her.
  const settlementCarerId = timesheet?.carer_id ?? null;
  // D-B1: same discipline as `paymentsUnknown` above — a failed or
  // still-in-flight settlement read must never render "not reimbursed yet"
  // (or re-offer "Mark reimbursed") over money that may already be back
  // with her (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B).
  const settlementsUnknown =
    settlementsQuery.isError || settlementsQuery.isPending;
  const reimbursementSettlement = settlementsUnknown
    ? null
    : (settlementsQuery.data?.find(s => s.carer_id === settlementCarerId) ??
      null);
  const reimbursementSettledOn = reimbursementSettlement?.settled_at ?? null;
  const reimbursementSettledAmountMinor =
    reimbursementSettlement?.amount_minor ?? null;

  // Screen owns the mutation, the card owns the callback — same split as
  // `onMarkPaidPress`. The refusal is stated on the card, next to the button
  // that caused it (GOLDEN-FIXES #40), never as a toast.
  const handleMarkReimbursed = async () => {
    if (!settlementCarerId || markReimbursed.isPending) return;
    markReimbursed.reset();
    try {
      await markReimbursed.mutateAsync({
        householdId,
        input: {
          carer_id: settlementCarerId,
          week_start: weekStartISO,
          settled_at: todayISO,
        },
      });
    } catch {
      // Rendered inline below; swallowed here so the rejection is handled.
    }
  };

  const handleOpenRecordPayment = () => {
    setOverPayment(null);
    paymentIntentKeyRef.current = Crypto.randomUUID();
    setIsRecordPaymentVisible(true);
  };

  // Sheet-owns-values, screen-owns-mutation: the sheet is closed ONLY on
  // success, so a refusal leaves every typed figure in place — and the
  // over-payment case additionally states the server's own ceiling inline,
  // because a toast alone cannot say which number was too big.
  const handleRecordPayment = async (input: CreatePaymentInput) => {
    if (!timesheet || recordPayment.isPending) return;
    setOverPayment(null);
    const idempotencyKey = paymentIntentKeyRef.current;
    try {
      await recordPayment.mutateAsync({
        timesheetId: timesheet.id,
        input: idempotencyKey
          ? { ...input, idempotency_key: idempotencyKey }
          : input,
      });
    } catch (error) {
      setOverPayment(overPaymentMetadata(error));
      return;
    }
    paymentIntentKeyRef.current = null;
    setIsRecordPaymentVisible(false);
    showSuccessToast(t('paid.recordedToast'));
  };

  // D-20. The detail sheet is closed FIRST: a `BottomSheetBase` presented over
  // an already-presented one is invisible on iOS (GOLDEN-FIXES #1's family),
  // so the leaf must go before the correction sheet arrives.
  const handleOpenCorrection = (payment: Payment) => {
    setSelectedPaymentId(null);
    setCorrectionRefusal(null);
    setCorrectingPayment(payment);
  };

  // Same discipline as `handleRecordPayment`: the sheet is closed ONLY on
  // success, so a refusal leaves the typed reversal and the typed reason in
  // place, and the server's own figures are stated inline rather than in a
  // toast the open sheet would hide (GOLDEN-FIXES #40).
  const handleCorrectPayment = async (input: CreatePaymentCorrectionInput) => {
    if (!timesheet || !correctingPayment || correctPayment.isPending) return;
    setCorrectionRefusal(null);
    try {
      await correctPayment.mutateAsync({
        timesheetId: timesheet.id,
        paymentId: correctingPayment.id,
        input,
      });
    } catch (error) {
      setCorrectionRefusal(correctionRefusalMetadata(error));
      return;
    }
    setCorrectingPayment(null);
    showSuccessToast(t('paid.correctionRecordedToast'));
  };

  // `.mutateAsync(...).then(onFulfilled)` with no rejection handler left a
  // failure's promise entirely unhandled (an "Uncaught (in promise)" in
  // metro.log, the same defect class as the clock-in double-tap bug) even
  // though the mutation's own `onError` still showed a toast. try/catch
  // consumes the rejection here; the toast is unchanged.
  const handleApprove = async () => {
    if (!timesheet || !isActionable || approveTimesheet.isPending) return;
    try {
      await approveTimesheet.mutateAsync({
        timesheetId: timesheet.id,
        adjustment: stagedAdjustment ?? undefined,
      });
    } catch {
      // The staged adjustment SURVIVES a refusal on purpose: a lost CAS race
      // or a network failure is a retry, not a change of mind.
      return;
    }
    setPendingAdjustment(null);
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

  // Same sheet-stays-open discipline as `handleRecordPayment`: the dialog is
  // closed ONLY on success, so the typed reason survives a refusal — and the
  // paid-week 409 is stated INSIDE the dialog, never as a toast the open
  // BottomSheetBase would hide (GOLDEN-FIXES #40).
  const handleReopen = async (reason: string) => {
    if (!timesheet || !isApproved || reopenTimesheet.isPending) return;
    setReopenRefusal(null);
    try {
      await reopenTimesheet.mutateAsync({ timesheetId: timesheet.id, reason });
    } catch (error) {
      if (isPaidWeekReopenRefusal(error)) {
        // docs/11-MONEY.md: no figure, no sentence about a figure — fall back
        // to the server's own conflict copy rather than fabricating a total.
        setReopenRefusal(
          paidToDateLabel
            ? t('reopen.refusedPaid', { amount: paidToDateLabel })
            : getLocalizedErrorMessage(error, tErrors)
        );
      }
      return;
    }
    setIsReopenDialogOpen(false);
    showSuccessToast(t('reopenedToast'));
  };

  // D-19. Same try/catch discipline as approve/query: `.mutateAsync().then()`
  // with no rejection handler leaves an "Uncaught (in promise)" in metro.log
  // even though the hook's own `onError` still toasts.
  const handleWithdrawQuery = async () => {
    if (!timesheet || !isQueried || withdrawQuery.isPending) return;
    try {
      await withdrawQuery.mutateAsync({ timesheetId: timesheet.id });
    } catch {
      return;
    }
  };

  const handleConfirmWithdrawQuery = () => {
    setIsWithdrawDialogOpen(false);
    void handleWithdrawQuery();
  };

  // Confirmation is the message appearing in the thread with a name and a
  // timestamp — no toast (§3.1). `mutate`, not `mutateAsync`: there is
  // nothing to await, and the refusal is read off the mutation's own `error`
  // and rendered inside the card (GOLDEN-FIXES #40).
  const handleSendThreadMessage = (message: string) => {
    if (!timesheet) return;
    addThreadMessage.mutate({ timesheetId: timesheet.id, message });
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
              carerName={carerName}
              isPastMember={isPastMember}
              dayMinutes={dayMinutes}
              scheduledMinutes={scheduledMinutes}
              weekStartsOn={weekStartsOn}
              todayIndex={todayIndex}
              lead={lead}
            />
            {/* F-B1-3: two carers, two pay records, two approvals. One
                carer at a time, so the figure above is always the figure
                the button below approves. A departed carer gets a tab like
                anyone else — hiding her is what let her hours be summed
                into someone else's. Hidden entirely when the week has one
                carer: the single-carer screen is unchanged. */}
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
              timesheetStatus={timesheetStatusForDisplay}
              showPayBoundary
              earnings={earnings}
              earningsRole="parent"
              earningsReopened={reopened}
              earningsReopenReason={timesheet?.reopen_reason ?? null}
              approvedDateLabel={approvedDateLabel}
              parentViewedNote={parentViewedNote}
              // Walkthrough fix 1 — the reopen affordance lives in the
              // summary card, next to the status pill/gross, not below the
              // day rows. `readOnly` (a helper) never gets a handler, so a
              // helper never sees `hours-reopen-button` even on an approved
              // week.
              onReopenPress={
                readOnly
                  ? undefined
                  : () => {
                      setReopenRefusal(null);
                      setIsReopenDialogOpen(true);
                    }
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
                      // C — the highest-stakes button in the app and it used
                      // to say nothing about who hears it.
                      recipient: t('recipient.approve', {
                        name: approveDialogCarerName,
                      }),
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
                      recipient: t('recipient.query', {
                        name: approveDialogCarerName,
                      }),
                    }
              }
              // D-19: the parent's exit from `queried`, beside Approve. Not
              // `destructive` — taking a question back un-approves nothing
              // and erases nothing (the dialog's second sentence).
              tertiaryAction={
                readOnly || !isQueried
                  ? null
                  : {
                      testID: 'hours-withdraw-query-button',
                      label: t('withdrawQuery'),
                      disabled: withdrawQuery.isPending,
                      onPress: () => setIsWithdrawDialogOpen(true),
                    }
              }
              weekChanged={weekChanged}
              actionsNote={
                readOnly
                  ? null
                  : // C3 (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B): a
                    // failed timesheet read means `timesheet` is null, same
                    // as "nothing submitted yet" — this used to say
                    // "waiting for hours" (naming the wrong party: hers,
                    // not the read failure) instead of a neutral "we
                    // couldn't load this".
                    timesheetQuery.isError
                    ? t('couldntLoadHours')
                    : isActionable || isApproved
                      ? null
                      : isQueried
                        ? t('waitingAfterQuery', { name: carerName })
                        : t('waitingForHours', { name: carerName })
              }
            />
            {/* §7 fixed order item 4 — gross, breakdown link, staged
                adjustment and the settlement that answers it, one card
                DIRECTLY UNDER THE STATUS CARD (A1/A2). It used to sit in
                `ListFooterComponent`, and FlashList always paints
                header → data → footer — so the figure a parent is about to
                authorise sat below every one-minute punch of the week.
                Above the thread, not below it: on a queried week the
                composer is tall, and thread-first would re-bury the figure
                on exactly the week where the figure is disputed. A helper
                may SEE that the family has paid, and may never record that
                they have. */}
            <WeekMoneyCard
              earnings={earnings ?? null}
              timesheetStatus={timesheetStatusForDisplay}
              viewerRole="parent"
              carerId={timesheet?.carer_id ?? null}
              carerDisplayName={timesheet?.carer_display_name ?? ''}
              carerName={carerName}
              totalMinutes={totalMinutes}
              earningsError={timesheetQuery.isError}
              onRetryEarnings={() => void timesheetQuery.refetch()}
              onPressBreakdown={() => setBreakdownWeek(weekStartISO)}
              nothingUnusual={timesheet?.nothing_unusual ?? null}
              paidState={showSettlementHistory ? paidState : null}
              payments={payments}
              settlementCurrency={settlementCurrency}
              paidStateUnknown={paymentsUnknown}
              onRetryPayments={() => void paymentsQuery.refetch()}
              dueDate={dueDate}
              todayISO={todayISO}
              onPaymentPress={payment => setSelectedPaymentId(payment.id)}
              onMarkPaidPress={
                isApproved && !readOnly ? handleOpenRecordPayment : undefined
              }
              isMarkPaidDisabled={recordPayment.isPending}
              adjustment={
                stagedAdjustment && earningsOk
                  ? {
                      amountMinor: stagedAdjustment.amount_minor,
                      note: stagedAdjustment.note,
                      currency: earningsOk.currency,
                    }
                  : null
              }
              // Same read-only contract as `onMarkPaidPress`. Also gated on a
              // computed gross: an adjustment with no base to adjust is a
              // number with nothing behind it (docs/11-MONEY.md §4), and the
              // API refuses it anyway.
              onAdjustmentPress={
                !readOnly && isActionable && earnings?.status === 'ok'
                  ? () => setIsAdjustmentSheetVisible(true)
                  : undefined
              }
            />
            <WeekQueryThread
              messages={threadQuery.data?.messages ?? []}
              currentUserId={currentUserId}
              timeZone={timeZone}
              timesheetStatus={timesheetStatusForDisplay}
              viewerRole="parent"
              // C — a parent's reply goes to the carer.
              recipientName={approveDialogCarerName}
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
            {/* §7 fixed order item 3 — after day rows, approved-only,
                read-only so it renders for a helper too. */}
            <ReimbursementsCard
              approvedExpenses={approvedExpenses}
              totalMinor={earningsOk ? earningsOk.reimbursements_minor : null}
              currency={expensesCurrency}
              carerName={carerName ?? undefined}
              settledOn={reimbursementSettledOn}
              settledAmountMinor={reimbursementSettledAmountMinor}
              // The one-prop role fork: only this view supplies it, so a
              // helper (readOnly) and the nanny both get the same card
              // without the action.
              onMarkReimbursedPress={
                !readOnly && settlementCarerId && !settlementsUnknown
                  ? handleMarkReimbursed
                  : undefined
              }
              isMarkReimbursedDisabled={markReimbursed.isPending}
              markReimbursedError={
                markReimbursed.error
                  ? getLocalizedErrorMessage(markReimbursed.error, tErrors)
                  : null
              }
              settlementUnknown={settlementsUnknown}
              onRetrySettlements={() => void settlementsQuery.refetch()}
            />
            {/* Cross-week record, not gated on this week's approval — a
                helper reads settlements too, same as ReimbursementsCard. */}
            <PaymentsEntryRow
              subtitle={t('payments.subtitleParent')}
              onPress={() => router.push('/(private)/payments' as Href)}
            />
            {showSettlementHistory && timesheet && isApproved ? (
              <WeekExportAction
                timesheetId={timesheet.id}
                weekStartISO={weekStartISO}
                weekRangeLabel={weekRangeLabel}
                carerName={approveDialogCarerName}
                earnings={earningsOk}
                paidState={paidState}
              />
            ) : null}
            {/* Daylight P0-3: the "waiting" explainer and the Approve/Query/
                Withdraw buttons all moved into the summary card above
                (`WeekTotal`'s `actionsNote`/`primaryAction`/
                `secondaryAction`/`tertiaryAction`) — next to the figure they
                act on, not several screens below every day row. The query
                note itself is no longer rendered anywhere on this side: it
                is the thread's first message, shown to both. */}
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
        accessibilityLabel={t('carerWeek', { name: carerName })}
      />

      <QueryNoteSheet
        visible={isQuerySheetVisible}
        onDismiss={() => setIsQuerySheetVisible(false)}
        onSubmit={handleQuerySubmit}
        isSubmitting={queryTimesheet.isPending}
        title={t('queryTitle')}
        hint={t('queryHint', { name: carerName })}
        beforeYouSend={t('queryBeforeYouSend')}
        placeholder={t('queryNotePlaceholder')}
        submitLabel={t('querySubmit')}
      />

      {/* Outside the FlashList, with the other sheets: dismissal must never
          depend on which row is still mounted. `weekStart` is null on
          purpose — the week is the context this was opened from, and the
          "For the week" row would push a second Hours route onto the one
          already on screen. */}
      <PaymentDetailSheet
        visible={selectedPayment !== null}
        onDismiss={() => setSelectedPaymentId(null)}
        payment={selectedPayment}
        weekStart={null}
        paidToName={carerName ?? timesheet?.carer_display_name ?? null}
        recordedByName={resolveMemberDisplayName(
          selectedPayment?.recorded_by ?? null,
          currentUserId,
          membersByUserId,
          memberLabels
        )}
        // §4.1 — correcting is the PAYER's act, so this view passes the
        // action and `NannyWeekView`/`PaymentsScreen` do not. A helper
        // (`readOnly`) never gets it either, the same gate as "Mark as paid".
        onCorrectPress={readOnly ? undefined : handleOpenCorrection}
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
        adjustmentLabel={adjustmentLabel}
        adjustmentDirection={adjustmentDirection}
        nothingUnusual={timesheet?.nothing_unusual ?? null}
        structureLine={earningsOk ? earningsStructureLine(earningsOk) : null}
        supersedesLine={supersedesLine}
      />

      <WithdrawQueryDialog
        open={isWithdrawDialogOpen}
        onOpenChange={setIsWithdrawDialogOpen}
        onConfirm={handleConfirmWithdrawQuery}
        isSubmitting={withdrawQuery.isPending}
      />

      <ReopenWeekDialog
        open={isReopenDialogOpen}
        onOpenChange={setIsReopenDialogOpen}
        onConfirm={reason => void handleReopen(reason)}
        refusal={reopenRefusal}
        isSubmitting={reopenTimesheet.isPending}
        weekRangeLabel={weekRangeLabel}
        paidToDateLabel={paidToDateLabel}
      />

      {/* docs/11-MONEY.md §4 — unknown ≠ zero; no sheet without a settled
          balance. */}
      {timesheet && !readOnly && paidState ? (
        <RecordPaymentSheet
          visible={isRecordPaymentVisible}
          onDismiss={() => setIsRecordPaymentVisible(false)}
          onSubmit={input => void handleRecordPayment(input)}
          isSubmitting={recordPayment.isPending}
          outstandingMinor={paidState.balanceMinor}
          currency={
            earningsOk?.currency ?? activeHousehold.household?.currency ?? 'USD'
          }
          todayISO={todayISO}
          householdTimezone={timeZone}
          carerName={approveDialogCarerName}
          weekRangeLabel={weekRangeLabel}
          overPayment={overPayment}
        />
      ) : null}

      {timesheet && !readOnly ? (
        <PaymentCorrectionSheet
          visible={correctingPayment !== null}
          onDismiss={() => setCorrectingPayment(null)}
          onSubmit={input => void handleCorrectPayment(input)}
          isSubmitting={correctPayment.isPending}
          payment={correctingPayment}
          householdTimezone={timeZone}
          refusal={correctionRefusal}
        />
      ) : null}

      {earningsOk && !readOnly ? (
        <WeekAdjustmentSheet
          visible={isAdjustmentSheetVisible}
          onDismiss={() => setIsAdjustmentSheetVisible(false)}
          // Sheet-owns-values, screen-owns-mutation: the sheet hands back the
          // signed figure, this screen decides it is staged and closes.
          onSubmit={value => {
            setPendingAdjustment(value);
            setIsAdjustmentSheetVisible(false);
          }}
          onRemove={
            pendingAdjustment
              ? () => {
                  setPendingAdjustment(null);
                  setIsAdjustmentSheetVisible(false);
                }
              : undefined
          }
          computedGrossMinor={earningsOk.gross_minor}
          currency={earningsOk.currency}
          carerName={approveDialogCarerName}
          weekRangeLabel={weekRangeLabel}
          initialAdjustment={pendingAdjustment}
        />
      ) : null}

      {earningsOk ? (
        <EarningsBreakdownSheet
          visible={isBreakdownVisible}
          onDismiss={() => setBreakdownWeek(null)}
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

/** The pre-formatted `WeekTotal.weekChanged` block, or nothing to say. */
interface WeekChangedBlock {
  headline: string;
  /** A3 — names WHICH amount `amountLabel` is. Null wherever the figure is. */
  amountCaption: string | null;
  amountLabel: string | null;
  detail: string | null;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * THE MINUTES DELTA'S TWO OPERANDS MUST COME FROM THE SAME BASIS, and there
 * is a plausible wrong pair sitting right next to the right one.
 *
 * `timesheet.total_minutes` is `sumWorkedMinutes` over EVERY entry, including
 * `cancellation_paid`. A `WeekEarnings.worked_minutes` is the engine's own
 * `worked` + `manual_adjustment` basis. Subtracting one from the other is
 * plausible, compiles, and is WRONG on any week containing a paid
 * cancellation — it would tell a nanny she logged hours she did not.
 *
 * So both operands here always come from the same engine field, and there is
 * no third source. Do not "simplify" either of these to `total_minutes`.
 */
function addedMinutesBetween(after: number, before: number): number {
  return after - before;
}

/**
 * D79 shape A — the week was PAID, so it kept its approval and its frozen
 * snapshot (102), and `revised_earnings` says what it would come to now.
 *
 * Four branches render a SENTENCE AND NO FIGURE, because on each of them the
 * delta is not derivable and `£0.00` would be a lie (`docs/11-MONEY.md` §4):
 * no `revised_earnings` at all (an older API), a non-`ok` revised state, two
 * different currencies, and a week that shrank rather than grew.
 */
export function buildPaidWeekChanged({
  t,
  name,
  date,
  frozen,
  revised,
}: {
  t: Translate;
  name: string;
  date: string | null;
  frozen: WeekEarningsOk | null;
  revised: WeekEarningsStateResult | null | undefined;
}): WeekChangedBlock {
  const headline = t('paidWeek.changedHeadline', { name });
  const unpriced: WeekChangedBlock = {
    headline,
    amountCaption: null,
    amountLabel: null,
    detail: date ? t('paidWeek.changedDetailUnpriced', { name, date }) : null,
  };
  const revisedOk = revised && revised.status === 'ok' ? revised : null;
  if (!revisedOk || !frozen || revisedOk.currency !== frozen.currency) {
    return unpriced;
  }
  const deltaMinor = revisedOk.gross_minor - frozen.gross_minor;
  const addedMinutes = addedMinutesBetween(
    revisedOk.worked_minutes,
    frozen.worked_minutes
  );
  if (deltaMinor > 0 && addedMinutes > 0 && date) {
    return {
      headline,
      // The approval and its payments STAND, so this figure really is a
      // separate amount still to settle — the caption is what stops it
      // being read as the whole week.
      amountCaption: t('paidWeek.changedAmountCaption'),
      amountLabel: t('paidWeek.changedAmountLabel', {
        amount: formatMoney(deltaMinor, frozen.currency),
      }),
      detail: t('paidWeek.changedDetail', {
        hours: formatEarningsDuration(addedMinutes),
        date,
        name,
      }),
    };
  }
  // The week shrank, or the money moved without the hours doing so (a
  // backdated rate). Both figures, stated; no "more", and no figure in the
  // amount slot — a negative in `Figure28` reads as money owed back.
  return {
    headline,
    amountCaption: null,
    amountLabel: null,
    detail: t('paidWeek.changedDetailLower', {
      approvedAmount: formatMoney(frozen.gross_minor, frozen.currency),
      newAmount: formatMoney(revisedOk.gross_minor, revisedOk.currency),
    }),
  };
}

/**
 * D79 shape B — the week was UNPAID, so the roll-up demoted it and copied the
 * approval it destroyed into `previous_approval` (111). `live` is the week's
 * ordinary live earnings; the comparison is against the receipt.
 *
 * Same "sentence, no figure" discipline, plus one branch the paid shape does
 * not have: a receipt with no `gross_minor`/`worked_minutes` at all (a
 * `no_arrangement` approval) states only that an approval existed and when.
 * That fact alone is the thing this defect was destroying.
 */
export function buildDemotedWeekChanged({
  t,
  name,
  date,
  approvedDate,
  previous,
  live,
}: {
  t: Translate;
  name: string;
  date: string | null;
  approvedDate: string;
  previous: PreviousApproval;
  live: WeekEarningsOk | null;
}): WeekChangedBlock {
  const headline = t('changedAfterApproval.headline', { approvedDate });
  const prevGross = previous.gross_minor;
  const prevCurrency = previous.currency;
  const prevWorked = previous.worked_minutes;
  if (prevGross === null || prevCurrency === null || prevWorked === null) {
    return { headline, amountCaption: null, amountLabel: null, detail: null };
  }
  const approvedAmount = formatMoney(prevGross, prevCurrency);
  const approvedHours = formatEarningsDuration(prevWorked);
  if (!live || live.currency !== prevCurrency) {
    return {
      headline,
      amountCaption: null,
      amountLabel: null,
      detail: date
        ? t('changedAfterApproval.detailUnpriced', {
            approvedAmount,
            approvedHours,
            name,
            date,
          })
        : null,
    };
  }
  const deltaMinor = live.gross_minor - prevGross;
  const addedMinutes = addedMinutesBetween(live.worked_minutes, prevWorked);
  const newAmount = formatMoney(live.gross_minor, live.currency);
  const newHours = formatEarningsDuration(live.worked_minutes);
  if (deltaMinor > 0 && addedMinutes > 0 && date) {
    const delta = formatMoney(deltaMinor, live.currency);
    return {
      headline,
      // A3: the approval was DESTROYED, so the big figure is the whole
      // week, not the delta. The delta used to sit here — in the same 28pt
      // tabular slot that holds a total everywhere else on this screen —
      // and a parent read it as what the week was now worth.
      amountCaption: t('changedAfterApproval.amountCaption'),
      amountLabel: t('changedAfterApproval.amountLabel', { amount: newAmount }),
      detail: t('changedAfterApproval.detail', {
        approvedAmount,
        approvedHours,
        name,
        addedHours: formatEarningsDuration(addedMinutes),
        date,
        newAmount,
        newHours,
        delta,
      }),
    };
  }
  // The week SHRANK. No reassurance here: "it doesn't take anything away"
  // would be false, and this is a money screen.
  return {
    headline,
    amountCaption: null,
    amountLabel: null,
    detail: t('changedAfterApproval.detailLower', {
      approvedAmount,
      approvedHours,
      newAmount,
      newHours,
    }),
  };
}
