/**
 * @module domains/schedule/components/ScheduleRespondScreen
 *
 * Nanny-facing screen: review a proposed "usual week" schedule pattern (the
 * parent's plan — days, times, covered children) and Accept or Decline.
 *
 * PRODUCT RULE: a proposed day whose time range falls outside the nanny's
 * own marked availability for that weekday shows a non-blocking WARNING
 * (`StatusPill variant="outside-hours"`, amber) next to that day — never a
 * block. Accepting must always remain possible regardless of any clash; the
 * clash check itself is delegated to the pure, tested `isOutsideAvailability`
 * helper in `../utils`, never re-derived inline.
 *
 * Decline goes through a confirm sheet via `BottomSheetBase` (hosts an
 * optional message Textarea — AlertDialog has no keyboard avoidance and
 * buries confirm under the keyboard on device; same migration as
 * ReopenWeekDialog). Accept is a single tap, no confirm needed. GOLDEN:
 * never a bare RN Modal (GOLDEN-FIXES.md #1).
 *
 * DOUBLE-TAP / STUCK-AFTER-ACCEPT: a successful respond re-fetches the
 * pattern (via the mutation's own cache invalidation) but this screen's own
 * JSX doesn't branch on the new status — without an explicit guard, the
 * Accept button would sit there re-enabled the instant `respond.isPending`
 * flips back to `false`, inviting a second tap. `hasRespondedRef` is a ref
 * (not state) because it must be checked and set SYNCHRONOUSLY, before the
 * first `await` — two taps landing in the same event-loop tick could both
 * pass a state-based check, since state updates don't apply until the next
 * render. `hasResponded` (state) additionally keeps the buttons visibly
 * disabled through the brief window between the mutation resolving and
 * navigation actually completing. On success, Accept navigates away
 * entirely rather than leaving the nanny on stale UI with nothing to do.
 *
 * Wave B: the covered-children lookup (`useChildren`) is keyed off
 * `pattern.data.household_id` — the pattern's OWN household, straight off
 * the fetched record — not `useIsOnboarded().householdId`/the switcher's
 * active household. This screen is reached by `patternId` alone, and the
 * pattern always belongs to a specific household regardless of which one a
 * nanny with several currently has selected.
 */
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import { type Href, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { InlineRetry } from '@/src/components/custom/InlineRetry';
import { RestrictedActionButton } from '@/src/components/custom/RestrictedActionButton';
import { BackButton } from '@/src/components/ui/back-button';
import { Button } from '@/src/components/ui/button';
import { FieldLabel } from '@/src/components/ui/field-label';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H1, H4, Small } from '@/src/components/ui/typography';
import { parseWeeklyDays } from '@/src/domains/setup/utils/commitmentRrule';
import { useRespondToSchedulePattern } from '@/src/hooks/mutations/useRespondToSchedulePattern';
import { useAvailability } from '@/src/hooks/queries/useAvailability';
import { useCanWriteHousehold } from '@/src/hooks/queries/useCanWriteHousehold';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholdCommitments } from '@/src/hooks/queries/useHouseholdCommitments';
import { useSchedulePattern } from '@/src/hooks/queries/useSchedulePattern';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { shiftsCalendarHref } from '@/src/lib/notificationRouteMap';
import { showSuccessToast } from '@/src/lib/toast';
import { getWeekdayOrder } from '@/src/lib/weekdayOrder';
import { useElevation } from '~/lib/design-tokens/elevation';
import {
  type AvailabilityRow,
  calculateDayHours,
  calculateWeekTotalHours,
  formatWallClockTime,
  isOutsideAvailability,
} from '../utils';

interface ScheduleRespondScreenProps {
  patternId: string;
}

function structuralNoteLabel(
  weekday: number,
  childIds: string[],
  commitments: ChildCommitment[]
): string | null {
  const childIdSet = new Set(childIds);
  for (const commitment of commitments) {
    if (!childIdSet.has(commitment.child_id)) continue;
    if (!parseWeeklyDays(commitment.rrule).includes(weekday)) continue;
    if (commitment.label) return commitment.label;
  }
  return null;
}

export function ScheduleRespondScreen({
  patternId,
}: ScheduleRespondScreenProps) {
  const { t } = useTranslation('schedule');
  const { t: tCommon } = useTranslation('common');
  const elevation = useElevation();
  const router = useRouter();

  const pattern = useSchedulePattern(patternId);
  const profile = useUserProfile();
  const availability = useAvailability();
  const children = useChildren(pattern.data?.household_id);
  const commitments = useHouseholdCommitments(pattern.data?.household_id);
  const respond = useRespondToSchedulePattern(patternId);
  // The PATTERN's own household — same rule as `useChildren`/`useHouseholdCommitments`
  // above (Wave B doc comment): this screen is reached by `patternId` alone, so the
  // reader's write permission is about the pattern's household, never the switcher's.
  const canWriteHousehold = useCanWriteHousehold(pattern.data?.household_id);

  const hasRespondedRef = useRef(false);
  const [hasResponded, setHasResponded] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineMessage, setDeclineMessage] = useState('');

  // `AvailabilityRow` mirrors the shared `CarerAvailability` wire type
  // exactly — earliest_start/latest_finish stay nullable end to end.
  // `isOutsideAvailability` treats a null bound as "no constraint on that
  // side", NOT as a clash — a nanny marked available with no hours set yet
  // is a real row, not equivalent to `is_available: false`.
  // Pattern B: `undefined` while the read is unknown (in flight OR failed) —
  // never `[]`. `isOutsideAvailability` treats a missing row as a clash, so a
  // `?? []` fallback painted the amber "outside your hours" warning across
  // EVERY day of a perfectly fine schedule whenever the read failed. Mirrors
  // the `availability !== undefined` guard WeekBlocksEditor already uses.
  const availabilityRows: AvailabilityRow[] | undefined =
    availability.data?.map(row => ({
      weekday: row.weekday,
      is_available: row.is_available,
      earliest_start: row.earliest_start,
      latest_finish: row.latest_finish,
    }));
  const availabilityUnknown =
    availabilityRows === undefined && !availability.isLoading;
  const childrenById = new Map(
    (children.data ?? []).map(child => [child.id, child])
  );

  if (pattern.isLoading) {
    return (
      <View
        testID="schedule-respond-screen"
        className="flex-1 items-center justify-center bg-background"
      >
        <LoadingIndicator />
      </View>
    );
  }

  // Pattern C2: on a failed (or settled-empty) pattern read `isLoading` is
  // false and `data` is undefined — the old combined guard held the spinner
  // forever with no way out. Same shape as ProposalReviewScreen.
  if (pattern.isError || !pattern.data) {
    return (
      <View testID="schedule-respond-error" className="flex-1 bg-background">
        <ErrorState variant="network" onRetry={() => pattern.refetch()} />
      </View>
    );
  }

  const displayOrder = getWeekdayOrder(profile.data?.week_starts_on);
  // A weekday may legitimately carry more than one block. Keep ALL blocks,
  // sorting by weekday display order then start_time, to avoid dropping blocks.
  const days = [...pattern.data.days].sort((a, b) => {
    const aOrder = displayOrder.indexOf(a.weekday);
    const bOrder = displayOrder.indexOf(b.weekday);
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.start_time.localeCompare(b.start_time);
  });
  const totalHours = calculateWeekTotalHours(days);
  const hoursPerWeekday = new Map<number, number>();
  for (const day of days) {
    const hrs = calculateDayHours(day.start_time, day.end_time);
    hoursPerWeekday.set(
      day.weekday,
      (hoursPerWeekday.get(day.weekday) ?? 0) + hrs
    );
  }
  const maxDayHours = Math.max(0, ...Array.from(hoursPerWeekday.values()));
  const householdCommitments = commitments.data ?? [];
  const patternHouseholdId = pattern.data.household_id;
  // No reason text while unresolved (fails toward WAIT, never toward an
  // unconfirmed "this family is gone") — only the disabled flag below covers
  // the loading gap.
  const closedReason =
    !canWriteHousehold.isLoading && !canWriteHousehold.canWrite
      ? tCommon('householdClosedReason')
      : null;
  const writeDisabled =
    respond.isPending || hasResponded || canWriteHousehold.isLoading;

  const handleAccept = async () => {
    if (hasRespondedRef.current || respond.isPending) return;
    hasRespondedRef.current = true;
    try {
      await respond.mutateAsync({ status: 'accepted' });
    } catch {
      hasRespondedRef.current = false;
      return;
    }
    showSuccessToast(t('respond.acceptedToast'));
    setHasResponded(true);
    // The PATTERN's own household, not the switcher's active one — a nanny
    // accepting family B's week while family A is selected was landing on
    // family A's calendar.
    const href = shiftsCalendarHref({ householdId: patternHouseholdId });
    router.replace((href ?? '/(private)/schedule/shifts') as Href);
  };

  const handleDecline = async () => {
    if (hasRespondedRef.current || respond.isPending) return;
    hasRespondedRef.current = true;
    const trimmed = declineMessage.trim();
    try {
      await respond.mutateAsync({
        status: 'declined',
        message: trimmed.length > 0 ? trimmed : undefined,
      });
    } catch {
      hasRespondedRef.current = false;
      return;
    }
    showSuccessToast(t('respond.declinedToast'));
    setHasResponded(true);
    router.back();
  };

  return (
    <View testID="schedule-respond-screen" className="flex-1 bg-background">
      <ScrollView
        testID="schedule-respond-scroll"
        className="flex-1"
        contentContainerStyle={SCREEN_CONTENT_STYLE}
      >
        <BackButton
          testID="schedule-respond-back"
          onPress={() => router.back()}
          label={tCommon('back')}
        />
        <H1>{t('respond.screenTitle')}</H1>
        <Body className="mt-2 text-muted-foreground">
          {t('respond.subtitle')}
        </Body>

        <View className="mt-6 gap-4">
          {availabilityUnknown ? (
            <InlineRetry
              testID="schedule-respond-availability-retry"
              message={t('respond.availabilityLoadFailed')}
              onRetry={() => void availability.refetch()}
            />
          ) : null}
          {days.map(day => {
            const outsideHours =
              availabilityRows !== undefined &&
              isOutsideAvailability(day, availabilityRows);
            const weekdayHours = hoursPerWeekday.get(day.weekday) ?? 0;
            const isShorterDay = weekdayHours < maxDayHours;
            const noteLabel = isShorterDay
              ? structuralNoteLabel(
                  day.weekday,
                  day.children.map(child => child.child_id),
                  householdCommitments
                )
              : null;
            return (
              <View
                key={day.id}
                testID={`schedule-respond-day-${day.id}`}
                className="gap-2 rounded-row bg-card p-4"
                style={elevation.row}
              >
                <View className="gap-2">
                  <Body weight="semibold" tabular>
                    {t(`weekday.${day.weekday}`)} ·{' '}
                    {formatWallClockTime(day.start_time)}–
                    {formatWallClockTime(day.end_time)}
                  </Body>
                  {outsideHours ? (
                    <StatusPill
                      variant="outside-hours"
                      label={t('respond.outsideHoursWarning')}
                      testID={`schedule-respond-outside-hours-${day.id}`}
                    />
                  ) : null}
                </View>

                {day.children.length > 0 ? (
                  <View className="gap-1.5">
                    <FieldLabel>{t('respond.childrenLabel')}</FieldLabel>
                    <View className="gap-2">
                      {day.children.map(dayChild => {
                        const child = childrenById.get(dayChild.child_id);
                        const wholeDay =
                          dayChild.start_time === null &&
                          dayChild.end_time === null;
                        const childStart = wholeDay
                          ? day.start_time
                          : (dayChild.start_time ?? day.start_time);
                        const childEnd = wholeDay
                          ? day.end_time
                          : (dayChild.end_time ?? day.end_time);
                        return (
                          <Body
                            key={dayChild.id}
                            tabular
                            className="text-muted-foreground"
                            testID={`schedule-respond-child-window-${dayChild.id}`}
                          >
                            {t('respond.childWindow', {
                              childName: child?.name ?? '',
                              start: formatWallClockTime(childStart),
                              end: formatWallClockTime(childEnd),
                            })}
                          </Body>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
                {isShorterDay ? (
                  <Small
                    testID={`schedule-respond-structural-note-${day.id}`}
                    className="text-muted-foreground"
                  >
                    {noteLabel
                      ? t('respond.structuralNoteLabelled', {
                          label: noteLabel,
                        })
                      : t('respond.structuralNote')}
                  </Small>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View
        testID="schedule-respond-footer"
        className="gap-3 bg-background px-6 pb-6 pt-4"
        style={elevation.row}
      >
        <Body testID="schedule-respond-total-hours" weight="semibold" tabular>
          {t('respond.totalHours', { hours: totalHours })}
        </Body>

        <RestrictedActionButton
          testID="schedule-respond-accept"
          label={t('respond.accept')}
          reason={closedReason}
          disabled={writeDisabled}
          onPress={() => void handleAccept()}
        />

        <RestrictedActionButton
          testID="schedule-respond-decline"
          label={t('respond.decline')}
          reason={closedReason}
          disabled={writeDisabled}
          variant="ghost"
          destructive
          onPress={() => setDeclineOpen(true)}
        />
        <BottomSheetBase
          sheetId="schedule-respond-decline"
          visible={declineOpen}
          onDismiss={() => setDeclineOpen(false)}
          fitContent
          showCloseButton
        >
          <View className="gap-4 px-6 pb-4">
            <H4>{t('respond.declineConfirmTitle')}</H4>
            <Body className="text-muted-foreground">
              {t('respond.declineConfirmBody')}
            </Body>
            <Textarea
              testID="schedule-respond-decline-message"
              accessibilityLabel={t('respond.declineMessageLabel')}
              value={declineMessage}
              onChangeText={setDeclineMessage}
              placeholder={t('respond.declineMessagePlaceholder')}
              className="min-h-[80px]"
            />
            <View className="gap-2">
              <Button variant="outline" onPress={() => setDeclineOpen(false)}>
                <Text>{t('respond.declineConfirmCancel')}</Text>
              </Button>
              <RestrictedActionButton
                testID="schedule-respond-decline-confirm"
                label={t('respond.declineConfirmConfirm')}
                reason={closedReason}
                disabled={writeDisabled}
                variant="destructive"
                onPress={() => void handleDecline()}
              />
            </View>
          </View>
        </BottomSheetBase>
      </View>
    </View>
  );
}
