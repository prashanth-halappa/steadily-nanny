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
 * Parent/helper only. Normal navigation never sends a nanny here, but a
 * deep link could — see `schedule-pending-not-available` below for the
 * honest not-available state that guards it (never a bare `null`).
 *
 * Wave B: `householdId` comes from `useActiveHousehold`, not
 * `useIsOnboarded().householdId` — a parent (Wave 1: owns exactly one
 * household) gets the identical id either way, but this keeps every
 * data-fetching screen going through the one hook actually responsible for
 * "which household".
 *
 * The `draft` state's "continue building" CTA passes the draft's own id as
 * `?patternId=` on the build route, so `ScheduleBuildScreen` resumes THAT
 * pattern (see its own header comment) instead of starting a fresh wizard
 * and — via `sendScheduleWeek`'s `!patternId` branch — creating a second,
 * orphaned draft on send. Every OTHER CTA that lands on the build screen
 * (empty state, accepted "change the week", declined/withdrawn "build a new
 * week") deliberately omits `patternId`: each of those starts a genuinely
 * NEW pattern, since there is no draft to resume in those states.
 */
import { type Href, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
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
import { Text } from '@/src/components/ui/text';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { PatternStatusIndicator } from '@/src/domains/schedule/components/PatternStatusIndicator';
import { SchedulePatternPreview } from '@/src/domains/schedule/components/SchedulePatternPreview';
import { parseWeeklyRruleInterval } from '@/src/domains/schedule/utils';
import { resolveMemberDisplayName } from '@/src/domains/schedule/utils/memberDisplayName';
import {
  canViewParentSchedule,
  isParentEditorRole,
} from '@/src/domains/setup/types';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { useWithdrawSchedulePattern } from '@/src/hooks/mutations/useWithdrawSchedulePattern';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useSchedulePattern } from '@/src/hooks/queries/useSchedulePattern';
import { useSchedulePatterns } from '@/src/hooks/queries/useSchedulePatterns';
import { useAuthStore } from '@/src/store/auth';
import { useElevation } from '~/lib/design-tokens/elevation';

const BUILD_HREF = '/(private)/schedule/build' as Href;
const SHIFTS_HREF = '/(private)/schedule/shifts' as Href;

export function SchedulePendingScreen() {
  const { t } = useTranslation('schedule');
  const { t: tCommon } = useTranslation('common');
  const elevation = useElevation();
  // Same tab-bar dead-zone fix as Settings (BUG1) — this is the Schedule
  // tab's root for a parent with no accepted pattern.
  const tabBarScrollPadding = useTabBarScrollPadding();
  const router = useRouter();
  const currentUserId = useAuthStore(s => s.user?.id ?? null);

  const onboarding = useIsOnboarded();
  const patterns = useSchedulePatterns(onboarding.householdId);
  const pattern = (patterns.data ?? []).find(p => p.status !== 'ended') ?? null;
  const withdraw = useWithdrawSchedulePattern(pattern?.id);
  const detail = useSchedulePattern(
    pattern && pattern.status !== 'draft' ? pattern.id : null
  );
  const children = useChildren(onboarding.householdId);
  const membersQuery = useHouseholdMembers(onboarding.householdId);
  const childrenById = new Map(
    (children.data ?? []).map(c => [
      c.id,
      { id: c.id, name: c.name, colour: c.colour },
    ])
  );
  const membersByUserId = useMemo(
    () =>
      new Map(
        (membersQuery.data ?? []).map(member => [member.user_id, member])
      ),
    [membersQuery.data]
  );
  const memberLabels = useMemo(
    () => ({
      you: t('detail.you'),
      someone: t('detail.someone'),
      roleFallback: (role: 'owner' | 'parent' | 'nanny' | 'helper') =>
        t(`detail.roleFallback.${role}`),
    }),
    [t]
  );
  const carerName = resolveMemberDisplayName(
    pattern?.carer_id,
    currentUserId,
    membersByUserId,
    memberLabels
  );

  const canEditSchedule = isParentEditorRole(onboarding.role);

  // Parent/helper only. Normal navigation never sends a nanny here, but a
  // bare `null` used to leave a deep-linked nanny staring at a blank
  // screen — no message, no back affordance, nothing. Mirrors
  // TimeOffScreen's `time-off-not-available` pattern.
  if (!canViewParentSchedule(onboarding.role)) {
    return (
      <View
        testID="schedule-pending-not-available"
        className="flex-1 bg-background"
      >
        <SafeAreaView style={{ flex: 1 }} className="bg-background">
          <View className="px-6 pt-4">
            <Pressable
              testID="schedule-pending-not-available-back"
              accessibilityRole="button"
              accessibilityLabel={tCommon('back')}
              onPress={() => router.back()}
              hitSlop={8}
              className="self-start"
            >
              <Body className="text-primary">{`< ${tCommon('back')}`}</Body>
            </Pressable>
          </View>
          <View className="mt-8 px-6">
            <EmptyState
              variant="inline"
              title={t('pending.notAvailableTitle')}
              description={t('pending.notAvailableDescription')}
            />
          </View>
        </SafeAreaView>
      </View>
    );
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

  const patternStatus = ():
    | 'pending'
    | 'accepted'
    | 'declined'
    | 'withdrawn' => {
    switch (pattern?.status) {
      case 'accepted':
        return 'accepted';
      case 'declined':
        return 'declined';
      case 'withdrawn':
        return 'withdrawn';
      default:
        return 'pending';
    }
  };

  return (
    <ScrollView
      testID="schedule-pending-screen"
      className="flex-1 bg-background"
      contentContainerStyle={{
        ...SCREEN_CONTENT_STYLE,
        paddingBottom: tabBarScrollPadding,
      }}
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
          {canEditSchedule ? (
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
      ) : pattern.status === 'draft' ? (
        <View testID="schedule-pending-draft" className="mt-6 gap-4">
          <Body weight="semibold">{t('pending.draftTitle')}</Body>
          <Body className="text-muted-foreground">
            {t('pending.draftBody')}
          </Body>
          {canEditSchedule ? (
            <Button
              testID="schedule-pending-continue-cta"
              onPress={() =>
                router.push(
                  `/(private)/schedule/build?patternId=${pattern.id}` as Href
                )
              }
            >
              <Text className="text-primary-foreground font-medium">
                {t('pending.draftCta')}
              </Text>
            </Button>
          ) : null}
        </View>
      ) : (
        <View className="mt-6 gap-4">
          <PatternStatusIndicator
            testID="schedule-pending-status"
            status={patternStatus()}
          />
          <Small
            testID="schedule-pending-subject"
            className="text-muted-foreground"
          >
            {t(
              parseWeeklyRruleInterval(pattern.rrule) === 2
                ? 'pending.subjectLineFortnightly'
                : 'pending.subjectLine',
              { start: formatDisplayDate(pattern.dtstart) }
            )}
          </Small>
          {pattern.until ? (
            <Small
              testID="schedule-pending-until"
              className="text-muted-foreground"
            >
              {t('pending.untilLine', {
                end: formatDisplayDate(pattern.until),
              })}
            </Small>
          ) : null}

          {detail.data && detail.data.days.length > 0 ? (
            <SchedulePatternPreview
              days={detail.data.days}
              childrenById={childrenById}
              until={pattern.until}
              exdates={pattern.exdates}
              pauseRanges={pattern.pause_ranges}
            />
          ) : null}

          {pattern.status === 'declined' && pattern.decline_message ? (
            <View
              testID="schedule-pending-decline-message"
              className="gap-1 rounded-row bg-card p-4"
              style={elevation.row}
            >
              <Body weight="medium">{t('pending.declineReasonLabel')}</Body>
              <Body className="text-muted-foreground">
                {pattern.decline_message}
              </Body>
            </View>
          ) : null}

          {pattern.status === 'pending' && canEditSchedule ? (
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
              <Body
                testID="schedule-pending-accepted-bridge"
                className="text-muted-foreground"
              >
                {t('pending.acceptedMeansShifts', { name: carerName })}
              </Body>
              <Button
                testID="schedule-pending-view-shifts"
                onPress={() => router.push(SHIFTS_HREF)}
              >
                <Text className="text-primary-foreground font-medium">
                  {t('pending.viewShifts')}
                </Text>
              </Button>
              {canEditSchedule ? (
                <Button
                  testID="schedule-pending-change-week"
                  variant="outline"
                  onPress={() => router.push(BUILD_HREF)}
                >
                  <Text>{t('pending.changeWeek')}</Text>
                </Button>
              ) : null}
            </>
          ) : null}

          {(pattern.status === 'declined' || pattern.status === 'withdrawn') &&
          canEditSchedule ? (
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
