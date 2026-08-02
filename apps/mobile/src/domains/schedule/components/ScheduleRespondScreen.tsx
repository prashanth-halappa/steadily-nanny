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
 * Decline goes through a confirm step via the shared `AlertDialog` family
 * (never a bare RN Modal component — GOLDEN-FIXES.md #1). Accept is a
 * single tap, no confirm dialog needed.
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
import { type Href, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/src/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { ChildChip } from '@/src/components/ui/child-chip';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H1 } from '@/src/components/ui/typography';
import { useRespondToSchedulePattern } from '@/src/hooks/mutations/useRespondToSchedulePattern';
import { useAvailability } from '@/src/hooks/queries/useAvailability';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useSchedulePattern } from '@/src/hooks/queries/useSchedulePattern';
import { showSuccessToast } from '@/src/lib/toast';
import {
  type AvailabilityRow,
  calculateWeekTotalHours,
  formatWallClockTime,
  isOutsideAvailability,
} from '../utils';

interface ScheduleRespondScreenProps {
  patternId: string;
}

export function ScheduleRespondScreen({
  patternId,
}: ScheduleRespondScreenProps) {
  const { t } = useTranslation('schedule');
  const router = useRouter();

  const pattern = useSchedulePattern(patternId);
  const availability = useAvailability();
  const children = useChildren(pattern.data?.household_id);
  const respond = useRespondToSchedulePattern(patternId);

  const hasRespondedRef = useRef(false);
  const [hasResponded, setHasResponded] = useState(false);
  const [declineMessage, setDeclineMessage] = useState('');

  // `AvailabilityRow` mirrors the shared `CarerAvailability` wire type
  // exactly — earliest_start/latest_finish stay nullable end to end.
  // `isOutsideAvailability` treats a null bound as "no constraint on that
  // side", NOT as a clash — a nanny marked available with no hours set yet
  // is a real row, not equivalent to `is_available: false`.
  const availabilityRows: AvailabilityRow[] = (availability.data ?? []).map(
    row => ({
      weekday: row.weekday,
      is_available: row.is_available,
      earliest_start: row.earliest_start,
      latest_finish: row.latest_finish,
    })
  );
  const childrenById = new Map(
    (children.data ?? []).map(child => [child.id, child])
  );

  if (pattern.isLoading || !pattern.data) {
    return (
      <View
        testID="schedule-respond-screen"
        className="flex-1 items-center justify-center bg-background"
      >
        <LoadingIndicator />
      </View>
    );
  }

  const days = pattern.data.days;
  const totalHours = calculateWeekTotalHours(days);

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
    router.replace('/(private)/schedule/shifts' as Href);
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
    <ScrollView
      testID="schedule-respond-screen"
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 24, paddingBottom: 100 }}
    >
      <H1>{t('respond.screenTitle')}</H1>
      <Body className="mt-2 text-muted-foreground">
        {t('respond.subtitle')}
      </Body>

      <View className="mt-6 gap-4">
        {days.map(day => {
          const outsideHours = isOutsideAvailability(day, availabilityRows);
          return (
            <View
              key={day.id}
              testID={`schedule-respond-day-${day.weekday}`}
              className="gap-2 rounded-xl border border-border p-4"
            >
              <View className="flex-row items-center justify-between gap-2">
                <Body className="font-sora-semibold">
                  {t(`weekday.${day.weekday}`)} ·{' '}
                  {formatWallClockTime(day.start_time)}–
                  {formatWallClockTime(day.end_time)}
                </Body>
                {outsideHours ? (
                  <StatusPill
                    variant="outside-hours"
                    label={t('respond.outsideHoursWarning')}
                    testID={`schedule-respond-outside-hours-${day.weekday}`}
                  />
                ) : null}
              </View>

              {outsideHours ? (
                <Body className="text-warning text-xs">
                  {t('respond.outsideHoursNote')}
                </Body>
              ) : null}

              {day.children.length > 0 ? (
                <View className="gap-1.5">
                  <Body className="text-muted-foreground text-xs">
                    {t('respond.childrenLabel')}
                  </Body>
                  <View className="flex-row flex-wrap gap-2">
                    {day.children.map(dayChild => {
                      const child = childrenById.get(dayChild.child_id);
                      return (
                        <ChildChip
                          key={dayChild.id}
                          name={child?.name ?? ''}
                          colour={child?.colour ?? undefined}
                          testID={`schedule-respond-child-${dayChild.id}`}
                        />
                      );
                    })}
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <Body
        testID="schedule-respond-total-hours"
        className="mt-6 font-sora-semibold"
      >
        {t('respond.totalHours', { hours: totalHours })}
      </Body>

      <View className="mt-8 gap-3">
        <Button
          testID="schedule-respond-accept"
          disabled={respond.isPending || hasResponded}
          onPress={() => void handleAccept()}
        >
          <Text>{t('respond.accept')}</Text>
        </Button>

        <AlertDialog>
          <AlertDialogTrigger
            testID="schedule-respond-decline"
            className="items-center justify-center py-2"
          >
            <Body className="text-destructive">{t('respond.decline')}</Body>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('respond.declineConfirmTitle')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('respond.declineConfirmBody')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Textarea
              testID="schedule-respond-decline-message"
              accessibilityLabel={t('respond.declineMessageLabel')}
              value={declineMessage}
              onChangeText={setDeclineMessage}
              placeholder={t('respond.declineMessagePlaceholder')}
              className="min-h-[80px]"
            />
            <AlertDialogFooter>
              <AlertDialogCancel>
                <Text>{t('respond.declineConfirmCancel')}</Text>
              </AlertDialogCancel>
              <AlertDialogAction
                testID="schedule-respond-decline-confirm"
                className={buttonVariants({ variant: 'destructive' })}
                disabled={respond.isPending || hasResponded}
                onPress={() => void handleDecline()}
              >
                <Text className="text-destructive-foreground">
                  {t('respond.declineConfirmConfirm')}
                </Text>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </View>
    </ScrollView>
  );
}
