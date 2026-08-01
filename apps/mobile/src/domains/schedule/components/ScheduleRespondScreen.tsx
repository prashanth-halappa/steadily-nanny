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
 */
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
import { Body, H1 } from '@/src/components/ui/typography';
import { useRespondToSchedulePattern } from '@/src/hooks/mutations/useRespondToSchedulePattern';
import { useAvailability } from '@/src/hooks/queries/useAvailability';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useSchedulePattern } from '@/src/hooks/queries/useSchedulePattern';
import { showSuccessToast } from '@/src/lib/toast';
import { calculateWeekTotalHours, isOutsideAvailability } from '../utils';

interface ScheduleRespondScreenProps {
  patternId: string;
}

export function ScheduleRespondScreen({
  patternId,
}: ScheduleRespondScreenProps) {
  const { t } = useTranslation('schedule');
  const onboarding = useIsOnboarded();

  const pattern = useSchedulePattern(patternId);
  const availability = useAvailability();
  const children = useChildren(onboarding.householdId);
  const respond = useRespondToSchedulePattern(patternId);

  // `isOutsideAvailability`'s `AvailabilityRow` requires non-null
  // earliest_start/latest_finish; the wire type allows null (no hours set
  // yet). Treat a row with no hours as unavailable for that weekday, same
  // as if `is_available` were false — the util already treats a missing
  // row that way.
  const availabilityRows = (availability.data ?? []).map(row => ({
    weekday: row.weekday,
    is_available:
      row.is_available &&
      row.earliest_start !== null &&
      row.latest_finish !== null,
    earliest_start: row.earliest_start ?? '',
    latest_finish: row.latest_finish ?? '',
  }));
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
    try {
      await respond.mutateAsync({ status: 'accepted' });
    } catch {
      return;
    }
    showSuccessToast(t('respond.acceptedToast'));
  };

  const handleDecline = async () => {
    try {
      await respond.mutateAsync({ status: 'declined' });
    } catch {
      return;
    }
    showSuccessToast(t('respond.declinedToast'));
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
                  {t(`weekday.${day.weekday}`)} · {day.start_time}–
                  {day.end_time}
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
          disabled={respond.isPending}
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
            <AlertDialogFooter>
              <AlertDialogCancel>
                <Text>{t('respond.declineConfirmCancel')}</Text>
              </AlertDialogCancel>
              <AlertDialogAction
                testID="schedule-respond-decline-confirm"
                className={buttonVariants({ variant: 'destructive' })}
                disabled={respond.isPending}
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
