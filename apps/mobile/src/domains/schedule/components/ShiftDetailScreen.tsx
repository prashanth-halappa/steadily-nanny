/**
 * @module domains/schedule/components/ShiftDetailScreen
 *
 * D23/D24 — single-shift detail: parent can edit wall-clock times + note;
 * assigned nanny can Accept a pending shift or counter-offer times. Hosts
 * the shift-scoped day thread. Pending + `parent_proposed` discriminates:
 * fresh extra (`kind=extra`, no `source_pattern_id`, `sequence===0`) → proposal copy;
 * demoted recurring/cover, pattern-sourced, or re-timed extras (`sequence>0`) → re-confirm copy.
 *
 * Wave B: the day-thread query (`useShiftEvents`) is keyed off `shift.household_id`
 * — the shift's OWN household, straight off the fetched record — not
 * `useIsOnboarded().householdId`/the switcher's active household. This
 * screen is reached by `shiftId` alone (deep link, push notification, or a
 * list elsewhere), and the shift always belongs to a specific household
 * regardless of which one a nanny with several currently has selected.
 *
 * The READER'S ROLE follows the same rule (Pattern A): it comes from her
 * membership row in the SHIFT's household (`membersQuery`), never from
 * `useIsOnboarded().role`, which answers about the active household. While it
 * is still unknown, Accept/Decline are disabled with a reason rather than
 * hidden. A failed read of either the shift or her memberships gets an
 * `ErrorState` with a retry — never a spinner, never "this shift doesn't
 * exist" (C4).
 */
import type { HouseholdRole } from '@steadily-nanny/shared-types/schemas/household.schema';
import type {
  Shift,
  ShiftChild,
  ShiftEvent,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { RestrictedActionButton } from '@/src/components/custom/RestrictedActionButton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/src/components/ui/alert-dialog';
import { Button } from '@/src/components/ui/button';
import { ChildChip } from '@/src/components/ui/child-chip';
import { FieldLabel } from '@/src/components/ui/field-label';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import {
  StatusPill,
  type StatusPillProps,
} from '@/src/components/ui/status-pill';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { TimeRangePicker } from '@/src/components/ui/time-range-picker';
import { isEndAfterStart } from '@/src/components/ui/time-range-picker.utils';
import { Body, H1, H2, H3, H4, Small } from '@/src/components/ui/typography';
import {
  shiftChangeRequestKindLabelKey,
  shiftChangeRequestStatusLabelKey,
} from '@/src/domains/schedule/constants/changeRequestKinds';
import {
  type CancellationPayVariant,
  hoursUntilStart,
  resolveCancellationPayOutcome,
} from '@/src/domains/schedule/utils/cancellationPay';
import { isCoverAskUrgent } from '@/src/domains/schedule/utils/coverAskDeadline';
import { resolveMemberDisplayName } from '@/src/domains/schedule/utils/memberDisplayName';
import { localDateToWeekday } from '@/src/domains/schedule/utils/shiftGrouping';
import {
  isParentEditorRole,
  SETUP_ROLES,
  type SetupRole,
} from '@/src/domains/setup/types';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { useAcceptShift } from '@/src/hooks/mutations/useAcceptShift';
import { useCreateShiftChangeRequest } from '@/src/hooks/mutations/useCreateShiftChangeRequest';
import { useDeclineShift } from '@/src/hooks/mutations/useDeclineShift';
import { useRespondToShiftChangeRequest } from '@/src/hooks/mutations/useRespondToShiftChangeRequest';
import { useUpdateShift } from '@/src/hooks/mutations/useUpdateShift';
import { useWithdrawChangeRequest } from '@/src/hooks/mutations/useWithdrawChangeRequest';
import { useCanWriteHousehold } from '@/src/hooks/queries/useCanWriteHousehold';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useRestrictedAction } from '@/src/hooks/queries/useRestrictedAction';
import { useShift } from '@/src/hooks/queries/useShift';
import { useShiftChangeRequests } from '@/src/hooks/queries/useShiftChangeRequests';
import { useShiftEvents } from '@/src/hooks/queries/useShiftEvents';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { httpStatusOf } from '@/src/lib/errorLocalization';
import { localDateInZone } from '@/src/lib/localDate';
import { showSuccessToast } from '@/src/lib/toast';
import {
  formatInstantDisplay,
  shiftInstantsFromWallClock,
  utcIsoToWallClockHHMM,
} from '@/src/lib/wallClock';
import { useAuthStore } from '@/src/store/auth';
import { useElevation } from '~/lib/design-tokens/elevation';

/** Known shift-event types map to `detail.eventType.*` — e.g. `detail.eventType.uncovered_care`. */
const KNOWN_EVENT_TYPES = new Set([
  'shift_updated',
  'pattern_conflict',
  'uncovered_care',
  // S4b — role-forked copy, see EventRow: the parent hears whose shift
  // overlaps; the nanny hears only that it overlaps another family's.
  'cross_family_clash',
]);

/**
 * The reader's raw membership role in the SHIFT's household -> the setup role
 * the rest of this screen branches on. `owner` and `parent` collapse, exactly
 * as `useIsOnboarded` collapses them — this screen only asks "may she edit".
 */
const HOUSEHOLD_ROLE_TO_SETUP_ROLE: Record<HouseholdRole, SetupRole> = {
  owner: SETUP_ROLES.PARENT,
  parent: SETUP_ROLES.PARENT,
  nanny: SETUP_ROLES.NANNY,
  helper: SETUP_ROLES.HELPER,
};

type ShiftStatusVariant = NonNullable<StatusPillProps['variant']>;

const STATUS_TO_VARIANT: Record<Shift['status'], ShiftStatusVariant> = {
  draft: 'pending',
  pending: 'pending',
  confirmed: 'confirmed',
  declined: 'declined',
  cancelled: 'cancelled',
  completed: 'confirmed',
};

const STATUS_TO_LABEL_KEY: Record<Shift['status'], string> = {
  draft: 'shifts.statusDraft',
  pending: 'shifts.statusPending',
  confirmed: 'shifts.statusConfirmed',
  declined: 'shifts.statusDeclined',
  cancelled: 'shifts.statusCancelled',
  completed: 'shifts.statusCompleted',
};

/**
 * The pay sentence the cancel dialog opens with, one per outcome
 * (`docs/design/attention-and-notifications.md` §6). `pending` says nothing
 * at all: the arrangement query hasn't answered, and a dialog that guesses
 * about someone's pay is worse than one that stays quiet about it.
 *
 * `paid` splits on whether the shift can be PRICED — see the lookup below.
 */
const CANCEL_PAY_KEY: Record<CancellationPayVariant, string | null> = {
  pending: null,
  unknown: 'detail.cancelPayUnknown',
  noCancellationTerms: 'detail.cancelPayNoCancellationTerms',
  unpaid: 'detail.cancelPayUnpaid',
  paid: 'detail.cancelPayPaid',
};

export function ShiftDetailScreen() {
  // 'inbox' added for M21: the deadline sentence shares ONE i18n key
  // (`inbox:items.pendingShift.deadline`) with `NeedsAttentionCard`'s
  // `deadlineForItem` — "byte-identical string... a deadline that lives
  // only on the card she tapped away from is a deadline she cannot check."
  const { t } = useTranslation(['schedule', 'today', 'inbox', 'common']);
  const { refreshControl } = usePullToRefresh();
  const elevation = useElevation();
  const router = useRouter();
  const params = useLocalSearchParams<{ shiftId?: string }>();
  const shiftId = typeof params.shiftId === 'string' ? params.shiftId : null;
  const onboarding = useIsOnboarded();
  const profile = useUserProfile();
  const currentUserId = useAuthStore(s => s.session?.user?.id ?? null);
  const shiftQuery = useShift(shiftId);
  const eventsQuery = useShiftEvents(shiftQuery.data?.household_id, shiftId);
  const membersQuery = useHouseholdMembers(shiftQuery.data?.household_id);
  const childrenQuery = useChildren(shiftQuery.data?.household_id);
  const updateShift = useUpdateShift();
  const acceptShift = useAcceptShift();
  const declineShift = useDeclineShift();
  const createChange = useCreateShiftChangeRequest();
  const respondChange = useRespondToShiftChangeRequest();
  const withdrawChange = useWithdrawChangeRequest();
  const changeRequests = useShiftChangeRequests(shiftId);
  // The carer's own arrangement — the ONE cancellation window in the product
  // (§6.1 / D21). `households.cancellation_paid_within_hours` is deprecated
  // and is never consulted here.
  const payArrangement = useCurrentPayArrangement(
    shiftQuery.data?.household_id,
    shiftQuery.data?.carer_id
  );
  const households = useHouseholds();
  const cancelRestriction = useRestrictedAction({
    householdId: shiftQuery.data?.household_id,
    action: t('detail.restrictedActionCancelShift'),
  });
  // Second, orthogonal gate from `useRestrictedAction` above: that hook asks
  // "does the OWNER_ONLY approval mode restrict THIS member"; this one asks
  // "is the reader still an active member of the SHIFT's household at all".
  // A removed member's row keeps its `role`, so `readerRole` below would
  // otherwise still resolve normally after her household closes.
  const canWriteHousehold = useCanWriteHousehold(shiftQuery.data?.household_id);
  const closedReason =
    !canWriteHousehold.isLoading && !canWriteHousehold.canWrite
      ? t('common:householdClosedReason')
      : null;

  const shift = shiftQuery.data;
  // Pattern A. The role that decides what this screen offers is the reader's
  // role IN THE SHIFT'S HOUSEHOLD — never `useIsOnboarded().role`, which is
  // resolved against whichever household the SWITCHER has selected. This
  // screen is reached by `shiftId` alone (push, deep link), so a nanny with
  // memberships in two families who followed a push about family B was
  // rendered with family A's role: parent edit fields on a shift she is the
  // carer for, and no Accept.
  //
  // `membersQuery` is already loaded for the shift's household and already
  // holds her own row — the same lookup `useRestrictedAction` does. The
  // fallback mirrors that hook exactly: `onboarding` is consulted ONLY when
  // the shift is in the active household, where both answers are about the
  // same family by definition.
  const readerHouseholdRole =
    membersQuery.data?.find(member => member.user_id === currentUserId)?.role ??
    (shift !== undefined && shift.household_id === onboarding.householdId
      ? onboarding.membershipRole
      : null);
  const readerRole = readerHouseholdRole
    ? HOUSEHOLD_ROLE_TO_SETUP_ROLE[readerHouseholdRole]
    : null;
  /** Neither source has answered: we do not yet know what she may do here. */
  const isRoleResolving = readerRole === null;
  const isParent = isParentEditorRole(readerRole);
  const isNanny = readerRole === SETUP_ROLES.NANNY;
  // `carer_id` only ever points at a carer, so while the role is still
  // resolving the id alone is enough to keep her answer form on screen —
  // disabled with a reason rather than hidden (§7).
  const isAssignedCarer =
    (isNanny || isRoleResolving) &&
    currentUserId !== null &&
    shift?.carer_id !== null &&
    shift?.carer_id === currentUserId;
  const canAcceptPending =
    Boolean(isAssignedCarer) && shift?.status === 'pending';
  // Fresh EXTRA proposals and demoted-after-edit shifts both land as
  // pending + parent_proposed. Discriminate: brand-new extra has no
  // source pattern AND sequence===0; migration 034 demotions bump
  // sequence only (kind/source_pattern_id stay), so sequence>0 extras
  // need re-confirm copy, not "new shift proposed".
  const isPendingParentProposed =
    shift?.status === 'pending' && shift.origin === 'parent_proposed';
  const isFreshExtraProposal =
    Boolean(isPendingParentProposed) &&
    shift?.kind === 'extra' &&
    shift.source_pattern_id === null &&
    shift.sequence === 0;
  const needsReconfirm =
    Boolean(isPendingParentProposed) && !isFreshExtraProposal;
  // §5.3/M21 — the cover-ask lifecycle, DERIVED, never a wire status of its
  // own. `expired` = cancelled + `cancelled_by` null + the stamped expiry
  // already past; `withdrawn` = cancelled WITH `cancelled_by` set (the
  // parent did it). Both only mean anything for the assigned carer.
  const coverAskExpiresAt = shift?.cover_ask_expires_at ?? null;
  const isAskExpired =
    Boolean(isAssignedCarer) &&
    shift?.status === 'cancelled' &&
    shift.cancelled_by === null &&
    coverAskExpiresAt !== null &&
    Date.parse(coverAskExpiresAt) <= Date.now();
  const isAskWithdrawn =
    Boolean(isAssignedCarer) &&
    shift?.status === 'cancelled' &&
    shift.cancelled_by !== null;
  const showAnswerByDeadline =
    Boolean(isAssignedCarer) &&
    shift?.status === 'pending' &&
    coverAskExpiresAt !== null;
  const readerTimeZone = profile.data?.timezone;
  const showShiftZone =
    Boolean(shift?.timezone) &&
    Boolean(readerTimeZone) &&
    shift?.timezone !== readerTimeZone;
  const membersByUserId = new Map(
    (membersQuery.data ?? []).map(member => [member.user_id, member])
  );
  const memberLabels = {
    you: t('detail.you'),
    someone: t('detail.someone'),
    roleFallback: (role: 'owner' | 'parent' | 'nanny' | 'helper') =>
      t(`detail.roleFallback.${role}`),
  };
  const nameFor = (userId: string | null | undefined) =>
    resolveMemberDisplayName(
      userId,
      currentUserId,
      membersByUserId,
      memberLabels
    );
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [note, setNote] = useState('');
  // Per shift id: expo-router reuses this screen across shiftId navigations,
  // but a refetch of the SAME id must not clobber in-progress edits.
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const [declineConfirmOpen, setDeclineConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  // The change-request id currently confirming withdrawal, or null — a list
  // of change requests can in principle hold more than one row, so this is
  // keyed by id rather than a bare boolean.
  const [withdrawConfirmId, setWithdrawConfirmId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!shift || hydratedFor === shift.id) return;
    setStartTime(utcIsoToWallClockHHMM(shift.starts_at, shift.timezone));
    setEndTime(utcIsoToWallClockHHMM(shift.ends_at, shift.timezone));
    setNote(shift.note ?? '');
    setHydratedFor(shift.id);
  }, [shift, hydratedFor]);

  const isRangeValid = isEndAfterStart(startTime, endTime);

  const handleSave = async () => {
    if (!shift || updateShift.isPending) return;
    // Overnight handling (end <= start rolls to the next calendar day) lives
    // in `shiftInstantsFromWallClock` — shared with the nanny counter-offer
    // below so the two can never disagree.
    const { starts_at, ends_at } = shiftInstantsFromWallClock(
      shift.local_date,
      startTime,
      endTime,
      shift.timezone
    );
    try {
      await updateShift.mutateAsync({
        shiftId: shift.id,
        input: {
          starts_at,
          ends_at,
          note: note.trim() === '' ? null : note.trim(),
        },
      });
    } catch {
      return;
    }
    showSuccessToast(t('detail.savedToast'));
    setHydratedFor(null);
  };

  // C4 — a FAILED read is neither a spinner nor "this shift doesn't exist".
  // `useIsOnboarded` reports a failed memberships query as `status: 'loading'`
  // plus `membershipsError`, so without this branch that failure spun forever
  // with no way back. For the shift itself: a 404/403 is a settled "gone or not yours"
  // — notFound copy, still recoverable via retry; everything else stays network.
  if (shiftQuery.isError || onboarding.membershipsError) {
    const shiftStatus = httpStatusOf(shiftQuery.error);
    const variant =
      shiftStatus === 404 || shiftStatus === 403 ? 'notFound' : 'network';
    return (
      <View testID="shift-detail-error" className="flex-1 bg-background">
        <ErrorState
          variant={variant}
          onRetry={() => {
            if (shiftQuery.isError) void shiftQuery.refetch();
            if (onboarding.membershipsError) onboarding.retryMemberships();
          }}
        />
      </View>
    );
  }

  if (shiftQuery.isLoading || onboarding.status === 'loading') {
    return (
      <View
        testID="shift-detail-loading"
        className="flex-1 items-center justify-center bg-background"
      >
        <LoadingIndicator />
      </View>
    );
  }

  // SETTLED null only: the error and loading branches above already returned,
  // so reaching here means the read succeeded and there is genuinely no shift.
  if (!shift) {
    return (
      <View testID="shift-detail-missing" className="flex-1 bg-background p-6">
        <H1>{t('detail.missingTitle')}</H1>
        <Button
          testID="shift-detail-back"
          className="mt-4"
          onPress={() => router.back()}
        >
          <Text>{t('detail.back')}</Text>
        </Button>
      </View>
    );
  }

  // S3 / D-48. ONE answer, read by both the dialog and the muted hint below
  // the pills, so the screen can never print two contradictory sentences
  // about the same shift (§6.1).
  const cancelPay = resolveCancellationPayOutcome(shift, payArrangement.data);
  const cancelPayKey =
    cancelPay.variant === 'paid' && cancelPay.amount === null
      ? // Hours known, rate not: keep "still paid", drop the money clause
        // rather than invent a figure (docs/11-MONEY.md).
        'detail.cancelPayPaidUnpriced'
      : CANCEL_PAY_KEY[cancelPay.variant];
  const cancelPaySentence = cancelPayKey
    ? t(cancelPayKey, {
        hours: cancelPay.hours,
        duration: cancelPay.duration,
        amount: cancelPay.amount,
      })
    : null;
  // S14: there is no direct cancel endpoint. Pressing the button opens a
  // request, and a dialog that reads like the shift is already cancelled
  // misrepresents what the button does — so this sentence is in every variant.
  const cancelDialogBody = [
    cancelPaySentence,
    t('detail.cancelNeedsAccept', { name: nameFor(shift.carer_id) }),
  ]
    .filter(Boolean)
    .join(' ');

  // S4 §7. The server gates a co-parent's cancel ONLY when the shift is short
  // notice (`shiftChangeRequestCommandService.create`), so this mirrors that
  // condition exactly — disabling a cancel the co-parent is actually allowed
  // to make would be the same lie in the other direction. Computed LIVE from
  // `short_notice_hours`, never from `shift.is_short_notice`: that flag is
  // stamped when the shift is authored, so a shift booked three weeks out
  // still reads false on the morning it starts.
  const household = households.data?.find(h => h.id === shift.household_id);
  const cancelReason =
    household !== undefined &&
    hoursUntilStart(shift.starts_at) < household.short_notice_hours
      ? cancelRestriction.reason
      : null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      className="bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        testID="shift-detail-screen"
        className="flex-1 bg-background"
        contentContainerStyle={SCREEN_CONTENT_STYLE}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        {/* Money/trust hierarchy pass: "Shift" is a constant, carries no
            information, and used to be the largest thing on screen at H1.
            Demoted below the H3 time so the fact outranks the label. */}
        <H4 testID="shift-detail-title">{t('detail.title')}</H4>
        <Body
          testID="shift-detail-subtitle"
          className="mt-2 text-muted-foreground"
          tabular
        >
          {formatDisplayDate(shift.local_date)}
          {showShiftZone ? ` · ${shift.timezone}` : ''}
        </Body>
        <View className="mt-3 flex-row flex-wrap items-center gap-2">
          <StatusPill
            testID={`shift-detail-status-${shift.status}`}
            variant={STATUS_TO_VARIANT[shift.status]}
            label={t(STATUS_TO_LABEL_KEY[shift.status])}
          />
          {shift.is_short_notice ? (
            <StatusPill
              testID="shift-detail-short-notice"
              variant="short-notice"
              label={t('shifts.shortNotice')}
            />
          ) : null}
        </View>
        {isFreshExtraProposal ? (
          <Small
            testID="shift-detail-fresh-proposal"
            className="mt-2 text-muted-foreground"
          >
            {isParent
              ? t('detail.freshProposalAwaitingCarer', {
                  name: nameFor(shift.carer_id),
                })
              : t('detail.freshProposal')}
          </Small>
        ) : null}
        {needsReconfirm ? (
          <Small
            testID="shift-detail-needs-reconfirm"
            className="mt-2 text-muted-foreground"
          >
            {isParent
              ? t('detail.needsReconfirmAwaitingCarer', {
                  name: nameFor(shift.carer_id),
                })
              : t('detail.needsReconfirm')}
          </Small>
        ) : null}
        {cancelPay.variant === 'paid' && cancelPaySentence ? (
          <Small
            testID="shift-detail-short-notice-hint"
            className="mt-2 text-muted-foreground"
          >
            {cancelPaySentence}
          </Small>
        ) : null}

        {/* §5.3/M21 — byte-identical to the inbox item's second clause, from
          one i18n key. A deadline that lives only on the card she tapped
          away from is a deadline she cannot check. Red inside the same
          urgent window as `NeedsAttentionCard`'s `deadlineForItem`
          (`coverAskDeadline.ts` — "same rule, same threshold"). */}
        {showAnswerByDeadline && coverAskExpiresAt ? (
          <Small
            testID="shift-detail-answer-by"
            className={
              isCoverAskUrgent(coverAskExpiresAt, Date.now())
                ? 'mt-2 text-destructive'
                : 'mt-2 text-muted-foreground'
            }
          >
            {t('inbox:items.pendingShift.deadline', {
              deadlineDate: formatDisplayDate(
                localDateInZone(shift.timezone, new Date(coverAskExpiresAt))
              ),
              deadlineTime: formatClockTime(coverAskExpiresAt, shift.timezone),
            })}
          </Small>
        ) : null}
        {isAskExpired && coverAskExpiresAt ? (
          <Small
            testID="shift-detail-ask-expired"
            className="mt-2 text-muted-foreground"
          >
            {t('detail.askExpired', {
              weekday: t(
                `weekday.${localDateToWeekday(localDateInZone(shift.timezone, new Date(coverAskExpiresAt)))}`
              ),
              time: formatClockTime(coverAskExpiresAt, shift.timezone),
            })}
          </Small>
        ) : null}
        {isAskWithdrawn ? (
          <Small
            testID="shift-detail-ask-withdrawn"
            className="mt-2 text-muted-foreground"
          >
            {t('detail.askWithdrawn')}
          </Small>
        ) : null}

        <ShiftChildrenBlock
          shiftChildren={shift.shift_children ?? []}
          childrenById={
            new Map((childrenQuery.data ?? []).map(child => [child.id, child]))
          }
          timeZone={shift.timezone}
        />

        {isParent ? (
          <View className="mt-6 gap-4" testID="shift-detail-edit">
            <FieldLabel>{t('detail.startLabel')}</FieldLabel>
            <TimeRangePicker
              testID="shift-detail-times"
              start={startTime}
              end={endTime}
              onChange={(nextStart, nextEnd) => {
                setStartTime(nextStart);
                setEndTime(nextEnd);
              }}
            />
            <FieldLabel>{t('detail.noteLabel')}</FieldLabel>
            <Textarea
              testID="shift-detail-note"
              value={note}
              onChangeText={setNote}
              accessibilityLabel={t('detail.noteLabel')}
            />
            <RestrictedActionButton
              testID="shift-detail-save"
              size="default"
              label={t('detail.save')}
              reason={closedReason}
              disabled={
                !isRangeValid ||
                updateShift.isPending ||
                canWriteHousehold.isLoading
              }
              onPress={() => void handleSave()}
            />
            {shift.status !== 'cancelled' ? (
              <RestrictedActionButton
                testID="shift-detail-cancel"
                variant="outline"
                size="default"
                label={t('detail.cancelShift')}
                reason={cancelReason ?? closedReason}
                disabled={createChange.isPending || canWriteHousehold.isLoading}
                onPress={() => setCancelConfirmOpen(true)}
              />
            ) : null}
            <AlertDialog
              open={cancelConfirmOpen}
              onOpenChange={setCancelConfirmOpen}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('today:shiftDetail.cancelConfirmTitle')}
                  </AlertDialogTitle>
                  <AlertDialogDescription testID="shift-detail-cancel-body">
                    {cancelDialogBody}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    testID="shift-detail-cancel-dismiss"
                    onPress={() => setCancelConfirmOpen(false)}
                  >
                    <Text>{t('today:shiftDetail.cancelConfirmCancel')}</Text>
                  </AlertDialogCancel>
                  <AlertDialogAction
                    testID="shift-detail-cancel-confirm"
                    onPress={() => {
                      setCancelConfirmOpen(false);
                      void createChange.mutateAsync({
                        shiftId: shift.id,
                        input: { kind: 'cancel' },
                      });
                    }}
                  >
                    <Text>{t('today:shiftDetail.cancelConfirmConfirm')}</Text>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </View>
        ) : (
          <View className="mt-6 gap-2" testID="shift-detail-readonly">
            {/* The shift window is the headline fact, not body text — it was
                indistinguishable from `shift.note` on the next line.
                Matches ClockInCard.tsx:727-733's treatment of the same
                fact. */}
            <H3 tabular>
              {utcIsoToWallClockHHMM(shift.starts_at, shift.timezone)} –{' '}
              {utcIsoToWallClockHHMM(shift.ends_at, shift.timezone)}
            </H3>
            {shift.note ? <Body>{shift.note}</Body> : null}
            {/* §5.3 — "the same defect class as S4": an expired or withdrawn
              ask must not offer Accept/Decline/Counter, which would exist
              only to return an error. The reason line above already told
              her why; the form simply does not render. */}
            {isAssignedCarer && !isAskExpired && !isAskWithdrawn ? (
              <View className="mt-4 gap-3" testID="shift-detail-counter-form">
                <FieldLabel>{t('detail.startLabel')}</FieldLabel>
                <TimeRangePicker
                  testID="shift-detail-counter-times"
                  start={startTime}
                  end={endTime}
                  onChange={(nextStart, nextEnd) => {
                    setStartTime(nextStart);
                    setEndTime(nextEnd);
                  }}
                />
                <View className="flex-row flex-wrap gap-2">
                  {/* Disabled WITH A REASON, never hidden, while her role in
                    this household is still unknown — a vanished Accept is
                    indistinguishable from a bug (§7). */}
                  {canAcceptPending ? (
                    <RestrictedActionButton
                      testID="shift-detail-accept"
                      size="default"
                      label={t('detail.accept')}
                      reason={
                        isRoleResolving
                          ? t('detail.roleResolving')
                          : closedReason
                      }
                      disabled={
                        acceptShift.isPending || canWriteHousehold.isLoading
                      }
                      onPress={() =>
                        void acceptShift.mutateAsync({ shiftId: shift.id })
                      }
                    />
                  ) : null}
                  {canAcceptPending ? (
                    <RestrictedActionButton
                      testID="shift-detail-decline"
                      variant="outline"
                      size="default"
                      destructive
                      label={t('today:shiftDetail.declineCta')}
                      reason={
                        isRoleResolving
                          ? t('detail.roleResolving')
                          : closedReason
                      }
                      disabled={
                        declineShift.isPending || canWriteHousehold.isLoading
                      }
                      onPress={() => setDeclineConfirmOpen(true)}
                    />
                  ) : null}
                  <RestrictedActionButton
                    testID="shift-detail-counter"
                    variant={canAcceptPending ? 'outline' : 'default'}
                    size="default"
                    label={t('detail.counterOffer')}
                    reason={closedReason}
                    disabled={
                      !isRangeValid ||
                      createChange.isPending ||
                      canWriteHousehold.isLoading
                    }
                    onPress={() => {
                      // Same overnight-aware builder the parent's Save uses —
                      // never two instants off the one `local_date`.
                      const { starts_at, ends_at } = shiftInstantsFromWallClock(
                        shift.local_date,
                        startTime,
                        endTime,
                        shift.timezone
                      );
                      void createChange.mutateAsync({
                        shiftId: shift.id,
                        input: {
                          kind: 'counter_offer',
                          proposed_starts_at: starts_at,
                          proposed_ends_at: ends_at,
                        },
                      });
                    }}
                  />
                </View>
                <AlertDialog
                  open={declineConfirmOpen}
                  onOpenChange={setDeclineConfirmOpen}
                >
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t('today:shiftDetail.declineConfirmTitle')}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('today:shiftDetail.declineConfirmBody')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel
                        testID="shift-detail-decline-cancel"
                        onPress={() => setDeclineConfirmOpen(false)}
                      >
                        <Text>
                          {t('today:shiftDetail.declineConfirmCancel')}
                        </Text>
                      </AlertDialogCancel>
                      <AlertDialogAction
                        testID="shift-detail-decline-confirm"
                        onPress={() => {
                          setDeclineConfirmOpen(false);
                          void declineShift.mutateAsync({ shiftId: shift.id });
                        }}
                      >
                        <Text>
                          {t('today:shiftDetail.declineConfirmConfirm')}
                        </Text>
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </View>
            ) : null}
          </View>
        )}

        {(changeRequests.data ?? []).length > 0 ? (
          <View testID="shift-detail-changes" className="mt-8 gap-3">
            <H2>{t('detail.changesTitle')}</H2>
            {(changeRequests.data ?? []).map(req => {
              // The requester's own pending request: she withdraws it, she
              // does not accept/decline it. Same guard `awaitingNannyConfirm`
              // already uses just above — `requested_by !== null` first so a
              // system-authored row (null) never reads as "mine" just because
              // `currentUserId` also happens to be null in an unauthenticated
              // render.
              const isOwnRequest =
                req.requested_by !== null && req.requested_by === currentUserId;
              return (
                <View
                  key={req.id}
                  className="gap-2 rounded-row bg-card p-3"
                  style={elevation.row}
                >
                  <Body weight="medium">
                    {t(shiftChangeRequestKindLabelKey(req.kind), {
                      defaultValue: req.kind,
                    })}
                  </Body>
                  <Small className="text-muted-foreground">
                    {t(shiftChangeRequestStatusLabelKey(req.status), {
                      defaultValue: req.status,
                    })}
                  </Small>
                  <Small
                    testID={`shift-change-raised-by-${req.id}`}
                    className="text-muted-foreground"
                  >
                    {t('detail.raisedBy', { name: nameFor(req.requested_by) })}
                  </Small>
                  <Small
                    testID={`shift-change-created-${req.id}`}
                    className="text-muted-foreground"
                    tabular
                  >
                    {formatInstantDisplay(req.created_at, shift.timezone)}
                  </Small>
                  {req.status === 'pending' && isOwnRequest ? (
                    <Small
                      testID={`shift-change-awaiting-${req.id}`}
                      className="text-muted-foreground"
                    >
                      {t('detail.awaitingNannyConfirm')}
                    </Small>
                  ) : null}
                  {req.kind === 'cancel' &&
                  req.status === 'pending' &&
                  cancelPaySentence ? (
                    <Small
                      testID={`shift-change-cancel-pay-${req.id}`}
                      className="text-muted-foreground"
                    >
                      {cancelPaySentence}
                    </Small>
                  ) : null}
                  {req.status !== 'pending' && req.responded_by ? (
                    <Small
                      testID={`shift-change-responded-by-${req.id}`}
                      className="text-muted-foreground"
                    >
                      {t('detail.respondedBy', {
                        name: nameFor(req.responded_by),
                      })}
                    </Small>
                  ) : null}
                  {req.message ? (
                    <Body testID={`shift-change-message-${req.id}`}>
                      {t('detail.requestMessageLabel')}: {req.message}
                    </Body>
                  ) : null}
                  {req.response_message ? (
                    <Body testID={`shift-change-response-${req.id}`}>
                      {t('detail.responseLabel')}: {req.response_message}
                    </Body>
                  ) : null}
                  {req.status === 'pending' && isOwnRequest ? (
                    <RestrictedActionButton
                      testID={`shift-change-withdraw-${req.id}`}
                      variant="outline"
                      size="default"
                      destructive
                      label={t('today:shiftDetail.withdrawCta')}
                      reason={closedReason}
                      disabled={
                        withdrawChange.isPending || canWriteHousehold.isLoading
                      }
                      onPress={() => setWithdrawConfirmId(req.id)}
                    />
                  ) : null}
                  {req.status === 'pending' && !isOwnRequest ? (
                    <View className="flex-row gap-2">
                      <RestrictedActionButton
                        testID={`shift-change-accept-${req.id}`}
                        size="default"
                        label={t('detail.acceptChange')}
                        reason={closedReason}
                        disabled={
                          respondChange.isPending || canWriteHousehold.isLoading
                        }
                        onPress={() =>
                          void respondChange.mutateAsync({
                            changeRequestId: req.id,
                            input: { status: 'accepted' },
                          })
                        }
                      />
                      <RestrictedActionButton
                        testID={`shift-change-decline-${req.id}`}
                        variant="outline"
                        size="default"
                        label={t('detail.declineChange')}
                        reason={closedReason}
                        disabled={
                          respondChange.isPending || canWriteHousehold.isLoading
                        }
                        onPress={() =>
                          void respondChange.mutateAsync({
                            changeRequestId: req.id,
                            input: { status: 'declined' },
                          })
                        }
                      />
                    </View>
                  ) : null}
                  <AlertDialog
                    open={withdrawConfirmId === req.id}
                    onOpenChange={open => {
                      if (!open) setWithdrawConfirmId(null);
                    }}
                  >
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t('today:shiftDetail.withdrawConfirmTitle')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('today:shiftDetail.withdrawConfirmBody')}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel
                          testID={`shift-change-withdraw-cancel-${req.id}`}
                          onPress={() => setWithdrawConfirmId(null)}
                        >
                          <Text>
                            {t('today:shiftDetail.withdrawConfirmCancel')}
                          </Text>
                        </AlertDialogCancel>
                        <AlertDialogAction
                          testID={`shift-change-withdraw-confirm-${req.id}`}
                          onPress={() => {
                            setWithdrawConfirmId(null);
                            void withdrawChange.mutateAsync(req.id);
                          }}
                        >
                          <Text>
                            {t('today:shiftDetail.withdrawConfirmConfirm')}
                          </Text>
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </View>
              );
            })}
          </View>
        ) : null}

        <H2 className="mt-8">{t('detail.threadTitle')}</H2>
        <View testID="shift-detail-thread" className="mt-3 gap-3">
          {(eventsQuery.data ?? []).length === 0 ? (
            <Small testID="shift-detail-thread-empty">
              {t('detail.threadEmpty')}
            </Small>
          ) : (
            (eventsQuery.data ?? []).map(event => (
              <EventRow
                key={event.id}
                event={event}
                timeZone={shift.timezone}
                isNanny={isNanny}
                carerName={nameFor(shift.carer_id)}
              />
            ))
          )}
        </View>

        <Button
          testID="shift-detail-back"
          variant="outline"
          className="mt-8"
          onPress={() => router.back()}
        >
          <Text>{t('detail.back')}</Text>
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ShiftChildrenBlock({
  shiftChildren,
  childrenById,
  timeZone,
}: {
  shiftChildren: ShiftChild[];
  childrenById: Map<string, { name: string; colour: string | null }>;
  timeZone: string;
}) {
  const { t } = useTranslation('schedule');

  return (
    <View className="mt-6 gap-2" testID="shift-detail-children">
      <FieldLabel>{t('detail.childrenTitle')}</FieldLabel>
      {shiftChildren.length === 0 ? (
        <Small className="text-muted-foreground">
          {t('detail.childrenEmpty')}
        </Small>
      ) : (
        shiftChildren.map(link => {
          const child = childrenById.get(link.child_id);
          const wholeShift = link.starts_at === null && link.ends_at === null;
          const windowLabel = wholeShift
            ? t('detail.childWholeShift')
            : t('detail.childWindow', {
                start: utcIsoToWallClockHHMM(link.starts_at ?? '', timeZone),
                end: utcIsoToWallClockHHMM(link.ends_at ?? '', timeZone),
              });
          return (
            <View
              key={link.id}
              className="flex-row flex-wrap items-center gap-2"
              testID={`shift-detail-child-${link.id}`}
            >
              <ChildChip
                name={child?.name ?? ''}
                colour={child?.colour ?? undefined}
                testID={`shift-detail-child-chip-${link.id}`}
              />
              <Body tabular className="text-muted-foreground">
                {windowLabel}
              </Body>
            </View>
          );
        })
      )}
    </View>
  );
}

/** S4b — the ONE event type whose label is role-forked, never a household name. */
const CROSS_FAMILY_CLASH_EVENT_TYPE = 'cross_family_clash';

function EventRow({
  event,
  timeZone,
  isNanny,
  carerName,
}: {
  event: ShiftEvent;
  timeZone: string;
  /** Which sentence a `cross_family_clash` row uses — see the module doc. */
  isNanny: boolean;
  /** The assigned carer's display name, for the parent-side sentence. */
  carerName: string;
}) {
  const { t } = useTranslation('schedule');
  const elevation = useElevation();
  const known = KNOWN_EVENT_TYPES.has(event.event_type);
  const isCrossFamilyClash = event.event_type === CROSS_FAMILY_CLASH_EVENT_TYPE;
  const label = isCrossFamilyClash
    ? t(
        isNanny
          ? 'detail.eventType.crossFamilyClashNanny'
          : 'detail.eventType.crossFamilyClashParent',
        { carer: carerName }
      )
    : known
      ? t(`detail.eventType.${event.event_type}`, {
          defaultValue: event.event_type,
        })
      : t('detail.eventTypeUnknown');
  return (
    <View
      testID={`shift-event-${event.id}`}
      className="rounded-row bg-card p-3"
      style={elevation.row}
    >
      <Body weight="medium">{label}</Body>
      <Small className="text-muted-foreground" tabular>
        {formatInstantDisplay(event.created_at, timeZone)}
      </Small>
      {!known ? (
        <Small testID={`shift-event-fallback-${event.id}`}>
          {t('detail.eventTypeFallback', { type: event.event_type })}
        </Small>
      ) : null}
    </View>
  );
}
