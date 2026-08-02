/**
 * @module domains/schedule/components/SchedulePendingScreen
 *
 * Parent-facing landing screen at `/schedule` (index). Shows the household's
 * current schedule-pattern state and the next action for it:
 *
 *  - no pattern at all           -> empty state with a "build one" CTA
 *  - `draft` (started, not sent) -> prompt to continue building
 *  - `pending` (sent, awaiting)  -> status + preview + Withdraw action
 *  - `accepted`                  -> status + preview + link to this week's shifts
 *  - `declined` / `withdrawn`    -> status + decline note + CTA to build a new week
 *
 * Patterns come back from the API already ordered by `created_at` descending
 * (see `apps/api/src/domains/schedule/repositories/schedulePatternRepository.ts`),
 * so the first entry that isn't `ended` is the one this screen cares about.
 *
 * Parent-only. Normal navigation never sends a nanny here, but this renders
 * `null` defensively if it's ever reached by one.
 *
 * KNOWN GAP: the "continue building" CTA on the draft state always starts a
 * fresh build wizard (`/(private)/schedule/build`) rather than resuming the
 * specific in-progress draft pattern — resume-a-draft is out of scope for
 * this pass.
 */
import { type Href, useRouter } from 'expo-router';
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
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import {
  StatusPill,
  type StatusPillProps,
} from '@/src/components/ui/status-pill';
import { Text } from '@/src/components/ui/text';
import { Body, H1 } from '@/src/components/ui/typography';
import { SchedulePatternPreview } from '@/src/domains/schedule/components/SchedulePatternPreview';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useWithdrawSchedulePattern } from '@/src/hooks/mutations/useWithdrawSchedulePattern';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useSchedulePattern } from '@/src/hooks/queries/useSchedulePattern';
import { useSchedulePatterns } from '@/src/hooks/queries/useSchedulePatterns';

const BUILD_HREF = '/(private)/schedule/build' as Href;
const SHIFTS_HREF = '/(private)/schedule/shifts' as Href;

export function SchedulePendingScreen() {
  const { t } = useTranslation('schedule');
  const router = useRouter();

  const onboarding = useIsOnboarded();
  const patterns = useSchedulePatterns(onboarding.householdId);
  const pattern = (patterns.data ?? []).find(p => p.status !== 'ended') ?? null;
  const withdraw = useWithdrawSchedulePattern(pattern?.id);
  const detail = useSchedulePattern(
    pattern && pattern.status !== 'draft' ? pattern.id : null
  );
  const children = useChildren(onboarding.householdId);
  const childrenById = new Map(
    (children.data ?? []).map(c => [
      c.id,
      { id: c.id, name: c.name, colour: c.colour },
    ])
  );

  if (onboarding.role !== SETUP_ROLES.PARENT) {
    return null;
  }

  // Discarding the withdraw mutation's promise with a bare `void` operator
  // suppresses only the lint warning, not the rejection itself — a failure
  // would surface as an unhandled promise rejection. try/catch consumes it
  // here; `onError` on the mutation itself still shows the toast, unchanged.
  const handleWithdraw = async () => {
    try {
      await withdraw.mutateAsync();
    } catch {
      // onError already surfaced a toast.
    }
  };

  const isLoading = onboarding.status === 'loading' || patterns.isLoading;

  const statusVariant = (): NonNullable<StatusPillProps['variant']> => {
    switch (pattern?.status) {
      case 'accepted':
        return 'confirmed';
      case 'declined':
        return 'declined';
      case 'withdrawn':
        return 'cancelled';
      default:
        return 'pending';
    }
  };

  const statusLabel = (): string => {
    switch (pattern?.status) {
      case 'accepted':
        return t('pending.statusAccepted');
      case 'declined':
        return t('pending.statusDeclined');
      case 'withdrawn':
        return t('pending.statusWithdrawn');
      default:
        return t('pending.statusPending');
    }
  };

  return (
    <ScrollView
      testID="schedule-pending-screen"
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 24, paddingBottom: 100 }}
    >
      <H1>{t('pending.screenTitle')}</H1>

      {isLoading ? (
        <LoadingIndicator messages={[t('pending.loading')]} />
      ) : !pattern ? (
        <View testID="schedule-pending-empty" className="mt-6 gap-4">
          <EmptyState
            variant="inline"
            title={t('pending.emptyTitle')}
            description={t('pending.emptyBody')}
          />
          <Button
            testID="schedule-pending-build-cta"
            onPress={() => router.push(BUILD_HREF)}
          >
            <Text className="text-primary-foreground font-medium">
              {t('pending.emptyCta')}
            </Text>
          </Button>
        </View>
      ) : pattern.status === 'draft' ? (
        <View testID="schedule-pending-draft" className="mt-6 gap-4">
          <Body className="font-sora-semibold">{t('pending.draftTitle')}</Body>
          <Body className="text-muted-foreground">
            {t('pending.draftBody')}
          </Body>
          <Button
            testID="schedule-pending-continue-cta"
            onPress={() => router.push(BUILD_HREF)}
          >
            <Text className="text-primary-foreground font-medium">
              {t('pending.draftCta')}
            </Text>
          </Button>
        </View>
      ) : (
        <View className="mt-6 gap-4">
          <StatusPill
            testID="schedule-pending-status"
            variant={statusVariant()}
            label={statusLabel()}
          />

          {detail.data && detail.data.days.length > 0 ? (
            <SchedulePatternPreview
              days={detail.data.days}
              childrenById={childrenById}
            />
          ) : null}

          {pattern.status === 'declined' && pattern.decline_message ? (
            <View
              testID="schedule-pending-decline-message"
              className="gap-1 rounded-xl border border-border p-4"
            >
              <Body className="font-sora-medium">
                {t('pending.declineReasonLabel')}
              </Body>
              <Body className="text-muted-foreground">
                {pattern.decline_message}
              </Body>
            </View>
          ) : null}

          {pattern.status === 'pending' ? (
            <AlertDialog>
              <AlertDialogTrigger
                testID="schedule-pending-withdraw"
                className={buttonVariants({ variant: 'outline' })}
              >
                <Text>{t('pending.withdraw')}</Text>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('pending.withdrawConfirmTitle')}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('pending.withdrawConfirmBody')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    <Text>{t('pending.withdrawConfirmCancel')}</Text>
                  </AlertDialogCancel>
                  <AlertDialogAction
                    testID="schedule-pending-withdraw-confirm"
                    className={buttonVariants({ variant: 'destructive' })}
                    disabled={withdraw.isPending}
                    onPress={() => void handleWithdraw()}
                  >
                    <Text className="text-destructive-foreground">
                      {t('pending.withdrawConfirmConfirm')}
                    </Text>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}

          {pattern.status === 'accepted' ? (
            <>
              <Button
                testID="schedule-pending-view-shifts"
                onPress={() => router.push(SHIFTS_HREF)}
              >
                <Text className="text-primary-foreground font-medium">
                  {t('pending.viewShifts')}
                </Text>
              </Button>
              {/* A household's schedule changes — term starts, hours
                  shift, availability moves. Without this, the app went
                  permanently read-only the moment one week was accepted. */}
              <Button
                testID="schedule-pending-change-week"
                variant="outline"
                onPress={() => router.push(BUILD_HREF)}
              >
                <Text>{t('pending.changeWeek')}</Text>
              </Button>
            </>
          ) : null}

          {pattern.status === 'declined' || pattern.status === 'withdrawn' ? (
            <Button
              testID="schedule-pending-build-cta"
              onPress={() => router.push(BUILD_HREF)}
            >
              <Text className="text-primary-foreground font-medium">
                {t('pending.emptyCta')}
              </Text>
            </Button>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}
