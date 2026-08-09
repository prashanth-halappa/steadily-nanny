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
 */
import type {
  Shift,
  ShiftChild,
  ShiftEvent,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
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
import { Body, H1, H2, Small } from '@/src/components/ui/typography';
import {
  shiftChangeRequestKindLabelKey,
  shiftChangeRequestStatusLabelKey,
} from '@/src/domains/schedule/constants/changeRequestKinds';
import { resolveMemberDisplayName } from '@/src/domains/schedule/utils/memberDisplayName';
import { isParentEditorRole, SETUP_ROLES } from '@/src/domains/setup/types';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { useAcceptShift } from '@/src/hooks/mutations/useAcceptShift';
import { useCreateShiftChangeRequest } from '@/src/hooks/mutations/useCreateShiftChangeRequest';
import { useDeclineShift } from '@/src/hooks/mutations/useDeclineShift';
import { useRespondToShiftChangeRequest } from '@/src/hooks/mutations/useRespondToShiftChangeRequest';
import { useUpdateShift } from '@/src/hooks/mutations/useUpdateShift';
import { useWithdrawChangeRequest } from '@/src/hooks/mutations/useWithdrawChangeRequest';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useShift } from '@/src/hooks/queries/useShift';
import { useShiftChangeRequests } from '@/src/hooks/queries/useShiftChangeRequests';
import { useShiftEvents } from '@/src/hooks/queries/useShiftEvents';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
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
]);

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

export function ShiftDetailScreen() {
  const { t } = useTranslation(['schedule', 'today']);
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

  const shift = shiftQuery.data;
  const isParent = isParentEditorRole(onboarding.role);
  const isNanny = onboarding.role === SETUP_ROLES.NANNY;
  const isAssignedCarer =
    isNanny &&
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
  const [hydrated, setHydrated] = useState(false);
  const [declineConfirmOpen, setDeclineConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  // The change-request id currently confirming withdrawal, or null — a list
  // of change requests can in principle hold more than one row, so this is
  // keyed by id rather than a bare boolean.
  const [withdrawConfirmId, setWithdrawConfirmId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!shift || hydrated) return;
    setStartTime(utcIsoToWallClockHHMM(shift.starts_at, shift.timezone));
    setEndTime(utcIsoToWallClockHHMM(shift.ends_at, shift.timezone));
    setNote(shift.note ?? '');
    setHydrated(true);
  }, [shift, hydrated]);

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
          note: note.trim() || undefined,
        },
      });
    } catch {
      return;
    }
    showSuccessToast(t('detail.savedToast'));
    setHydrated(false);
  };

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

  return (
    <ScrollView
      testID="shift-detail-screen"
      className="flex-1 bg-background"
      contentContainerStyle={SCREEN_CONTENT_STYLE}
    >
      <H1 testID="shift-detail-title">{t('detail.title')}</H1>
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
          {t('detail.freshProposal')}
        </Small>
      ) : null}
      {needsReconfirm ? (
        <Small
          testID="shift-detail-needs-reconfirm"
          className="mt-2 text-muted-foreground"
        >
          {t('detail.needsReconfirm')}
        </Small>
      ) : null}
      {shift.is_short_notice ? (
        <Small
          testID="shift-detail-short-notice-hint"
          className="mt-2 text-muted-foreground"
        >
          {t('detail.shortNoticePaidHint')}
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
          <Button
            testID="shift-detail-save"
            disabled={updateShift.isPending}
            onPress={() => void handleSave()}
          >
            <Text>{t('detail.save')}</Text>
          </Button>
          {shift.status !== 'cancelled' ? (
            <Button
              testID="shift-detail-cancel"
              variant="outline"
              disabled={createChange.isPending}
              onPress={() => setCancelConfirmOpen(true)}
            >
              <Text>{t('detail.cancelShift')}</Text>
            </Button>
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
                <AlertDialogDescription>
                  {t('today:shiftDetail.cancelConfirmBody')}
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
          <Body tabular>
            {utcIsoToWallClockHHMM(shift.starts_at, shift.timezone)} –{' '}
            {utcIsoToWallClockHHMM(shift.ends_at, shift.timezone)}
          </Body>
          {shift.note ? <Body>{shift.note}</Body> : null}
          {isNanny ? (
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
                {canAcceptPending ? (
                  <Button
                    testID="shift-detail-accept"
                    disabled={acceptShift.isPending}
                    onPress={() =>
                      void acceptShift.mutateAsync({ shiftId: shift.id })
                    }
                  >
                    <Text>{t('detail.accept')}</Text>
                  </Button>
                ) : null}
                {canAcceptPending ? (
                  <Button
                    testID="shift-detail-decline"
                    variant="outline"
                    disabled={declineShift.isPending}
                    onPress={() => setDeclineConfirmOpen(true)}
                  >
                    <Text className="text-destructive">
                      {t('today:shiftDetail.declineCta')}
                    </Text>
                  </Button>
                ) : null}
                <Button
                  testID="shift-detail-counter"
                  variant={canAcceptPending ? 'outline' : 'default'}
                  disabled={createChange.isPending}
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
                >
                  <Text>{t('detail.counterOffer')}</Text>
                </Button>
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
                      <Text>{t('today:shiftDetail.declineConfirmCancel')}</Text>
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
            // does not accept/decline it. Same guard `awaitingCoParent`
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
                    {t('detail.awaitingCoParent')}
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
                  <Button
                    testID={`shift-change-withdraw-${req.id}`}
                    variant="outline"
                    disabled={withdrawChange.isPending}
                    onPress={() => setWithdrawConfirmId(req.id)}
                  >
                    <Text className="text-destructive">
                      {t('today:shiftDetail.withdrawCta')}
                    </Text>
                  </Button>
                ) : null}
                {req.status === 'pending' && !isOwnRequest ? (
                  <View className="flex-row gap-2">
                    <Button
                      testID={`shift-change-accept-${req.id}`}
                      disabled={respondChange.isPending}
                      onPress={() =>
                        void respondChange.mutateAsync({
                          changeRequestId: req.id,
                          input: { status: 'accepted' },
                        })
                      }
                    >
                      <Text>{t('detail.acceptChange')}</Text>
                    </Button>
                    <Button
                      testID={`shift-change-decline-${req.id}`}
                      variant="outline"
                      disabled={respondChange.isPending}
                      onPress={() =>
                        void respondChange.mutateAsync({
                          changeRequestId: req.id,
                          input: { status: 'declined' },
                        })
                      }
                    >
                      <Text>{t('detail.declineChange')}</Text>
                    </Button>
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
            <EventRow key={event.id} event={event} timeZone={shift.timezone} />
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

function EventRow({
  event,
  timeZone,
}: {
  event: ShiftEvent;
  timeZone: string;
}) {
  const { t } = useTranslation('schedule');
  const elevation = useElevation();
  const known = KNOWN_EVENT_TYPES.has(event.event_type);
  return (
    <View
      testID={`shift-event-${event.id}`}
      className="rounded-row bg-card p-3"
      style={elevation.row}
    >
      <Body weight="medium">
        {known
          ? t(`detail.eventType.${event.event_type}`, {
              defaultValue: event.event_type,
            })
          : t('detail.eventTypeUnknown')}
      </Body>
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
