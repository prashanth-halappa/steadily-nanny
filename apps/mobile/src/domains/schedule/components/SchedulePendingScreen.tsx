/**
 * @module domains/schedule/components/SchedulePendingScreen
 *
 * Usual-week detail screen, pushed from the Schedule tab's pattern banner
 * (`/(private)/schedule/usual-week`) — NOT the Schedule tab root; the
 * calendar (`ScheduleShiftsScreen`) is. Shows the household's schedule
 * pattern(s), ONE SECTION PER CARER (S7 — "PER-CARER EVERYWHERE", owner
 * decision, docs/AS-BUILT-SCHEDULE.md §6 S7/S8/S9; the design rule lives in
 * docs/design/screens-schedule.md's "Multi-nanny usual week" section):
 * a stale row for one carer must never outrank a live one for a different
 * carer, or hide behind it. Each carer's own precedence-resolved pattern
 * (`resolvePerCarerPatterns`, S8's fix for the `.find(p => p.status !==
 * 'ended')` this screen used to run across the WHOLE household) gets its
 * own block:
 *
 *  - no pattern at all           -> empty state with a "build one" CTA
 *  - `draft` (started, not sent) -> prompt to continue building
 *  - `pending` (sent, awaiting)  -> status + preview + "Sent X ago" (S6) +
 *                                   Withdraw action
 *  - `accepted`                  -> status + preview + link to this week's
 *                                   shifts
 *  - `declined` / `withdrawn`    -> status + decline note (S10: "See why"
 *                                   only offered by the banner when there's
 *                                   a reason to read) + CTA to build a new
 *                                   week
 *  - `ended`                     -> S9: its own state (read-only preview +
 *                                   "Set a new usual week"), not the empty
 *                                   state — an ended pattern used to be
 *                                   filtered out entirely, so this screen
 *                                   read "No schedule yet" for a household
 *                                   that plainly once had one.
 *
 * Patterns come back from the API already ordered by `created_at` descending
 * (see `apps/api/src/domains/schedule/repositories/schedulePatternRepository.ts`).
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
 * orphaned draft on send. The accepted-pattern "Change it" banner (rendered
 * by `app/(private)/(tabs)/schedule.tsx`, not this screen — an accepted
 * pattern routes straight to `ScheduleShiftsScreen` and never reaches here)
 * does the same: it resumes the accepted pattern by id rather than starting
 * fresh, since editing and re-sending an accepted week no longer needs to
 * orphan it into a second pattern — the API supersedes the prior accepted
 * pattern on accept instead. Only the empty-state and declined/withdrawn
 * "build a new week" CTAs below still omit `patternId`: each of those
 * starts a genuinely NEW pattern, since there is no draft to resume in
 * those states.
 */
import type {
  AmendSchedulePatternInput,
  SchedulePattern,
} from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { type Href, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
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
  AlertDialogTrigger,
} from '@/src/components/ui/alert-dialog';
import { BackButton } from '@/src/components/ui/back-button';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Body, H1, H3, Small } from '@/src/components/ui/typography';
import { AdjustSchedulePatternSheet } from '@/src/domains/schedule/components/AdjustSchedulePatternSheet';
import { PatternStatusIndicator } from '@/src/domains/schedule/components/PatternStatusIndicator';
import { SchedulePatternPreview } from '@/src/domains/schedule/components/SchedulePatternPreview';
import { parseWeeklyRruleInterval } from '@/src/domains/schedule/utils';
import { resolveMemberDisplayName } from '@/src/domains/schedule/utils/memberDisplayName';
import { resolvePerCarerPatterns } from '@/src/domains/schedule/utils/patternPrecedence';
import { relativeDaysAgo } from '@/src/domains/schedule/utils/relativeDaysAgo';
import {
  canViewParentSchedule,
  isParentEditorRole,
} from '@/src/domains/setup/types';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { useAmendSchedulePattern } from '@/src/hooks/mutations/useAmendSchedulePattern';
import { useWithdrawSchedulePattern } from '@/src/hooks/mutations/useWithdrawSchedulePattern';
import { onboardingAsQuery, queryState } from '@/src/hooks/queries/queryState';
import { useCanWriteHousehold } from '@/src/hooks/queries/useCanWriteHousehold';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useSchedulePattern } from '@/src/hooks/queries/useSchedulePattern';
import { useSchedulePatterns } from '@/src/hooks/queries/useSchedulePatterns';
import { showSuccessToast } from '@/src/lib/toast';
import { useAuthStore } from '@/src/store/auth';
import { useElevation } from '~/lib/design-tokens/elevation';

const BUILD_HREF = '/(private)/schedule/build' as Href;
const SHIFTS_HREF = '/(private)/schedule/shifts' as Href;

type ChildSummary = { id: string; name: string; colour: string | null };

/**
 * One carer's pattern, fully self-contained: it owns its own detail /
 * withdraw / amend queries, so mounting N of these (one per carer) never
 * shares mutation state between carers.
 */
function SchedulePendingCarerSection({
  pattern,
  carerName,
  canEditSchedule,
  childrenById,
  showCarerLabel,
  closedReason,
  writeDisabled,
}: {
  pattern: SchedulePattern;
  carerName: string;
  canEditSchedule: boolean;
  childrenById: Map<string, ChildSummary>;
  showCarerLabel: boolean;
  /** Non-null once `useCanWriteHousehold` has confirmed this household is
   * closed — the shared "closed" sentence, or null while open/unresolved. */
  closedReason: string | null;
  /** True while `useCanWriteHousehold` hasn't resolved yet — every write
   * action stays disabled (no reason text) rather than acting on a guess. */
  writeDisabled: boolean;
}) {
  const { t } = useTranslation('schedule');
  const router = useRouter();
  const elevation = useElevation();

  const withdraw = useWithdrawSchedulePattern(pattern.id);
  const amend = useAmendSchedulePattern(pattern.id);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const detail = useSchedulePattern(
    pattern.status !== 'draft' ? pattern.id : null
  );

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

  // Same try/catch discipline as handleWithdraw above.
  const handleAmend = async (input: AmendSchedulePatternInput) => {
    try {
      await amend.mutateAsync(input);
    } catch {
      return;
    }
    setAdjustOpen(false);
    showSuccessToast(t('pending.adjustSuccessToast'));
  };

  const patternStatus = ():
    | 'pending'
    | 'accepted'
    | 'declined'
    | 'withdrawn'
    | 'ended' => {
    switch (pattern.status) {
      case 'accepted':
        return 'accepted';
      case 'declined':
        return 'declined';
      case 'withdrawn':
        return 'withdrawn';
      case 'ended':
        return 'ended';
      default:
        return 'pending';
    }
  };

  // S6: the parent's pending week read identically on day 1 and day 30 —
  // no sense of how long it had been sitting unanswered. Age-only.
  const sentAgo =
    pattern.status === 'pending' && pattern.sent_at
      ? relativeDaysAgo(
          pattern.sent_at,
          new Date().toISOString().slice(0, 10),
          t
        )
      : null;

  return (
    <View className="gap-4">
      {showCarerLabel ? (
        <H3 testID="schedule-pending-carer-name">{carerName}</H3>
      ) : null}
      {pattern.status === 'draft' ? (
        <View testID="schedule-pending-draft" className="gap-4">
          <Body weight="semibold">{t('pending.draftTitle')}</Body>
          <Body className="text-muted-foreground">
            {t('pending.draftBody')}
          </Body>
          {canEditSchedule ? (
            <RestrictedActionButton
              testID="schedule-pending-continue-cta"
              label={t('pending.draftCta')}
              reason={closedReason}
              disabled={writeDisabled}
              onPress={() =>
                router.push(
                  `/(private)/schedule/build?patternId=${pattern.id}` as Href
                )
              }
            />
          ) : null}
        </View>
      ) : (
        <View className="gap-4">
          <PatternStatusIndicator
            testID="schedule-pending-status"
            status={patternStatus()}
          />
          {sentAgo ? (
            <Small
              testID="schedule-pending-sent-age"
              className="text-muted-foreground"
            >
              {sentAgo}
            </Small>
          ) : null}
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
                disabled={writeDisabled || closedReason !== null}
                accessibilityHint={closedReason ?? undefined}
              >
                <Text>{t('pending.withdraw')}</Text>
              </AlertDialogTrigger>
              {/* Never hidden (S4/§7): the trigger stays visible and
                  disabled above, with the same sentence `RestrictedActionButton`
                  would show beneath a plain Button — the trigger itself isn't
                  one, so the reason is rendered here alongside it instead. */}
              {closedReason ? (
                <Small
                  testID="schedule-pending-withdraw-reason"
                  className="text-muted-foreground"
                >
                  {closedReason}
                </Small>
              ) : null}
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
                    disabled={withdraw.isPending || closedReason !== null}
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
                <RestrictedActionButton
                  testID="schedule-pending-change-week"
                  variant="outline"
                  label={t('pending.changeWeek')}
                  reason={closedReason}
                  disabled={writeDisabled}
                  onPress={() => router.push(BUILD_HREF)}
                />
              ) : null}
              {canEditSchedule ? (
                <RestrictedActionButton
                  testID="schedule-pending-adjust"
                  variant="outline"
                  label={t('pending.adjust')}
                  reason={closedReason}
                  disabled={writeDisabled}
                  onPress={() => setAdjustOpen(true)}
                />
              ) : null}
              {canEditSchedule ? (
                <AdjustSchedulePatternSheet
                  visible={adjustOpen}
                  onDismiss={() => setAdjustOpen(false)}
                  dtstart={pattern.dtstart}
                  until={pattern.until}
                  pauseRanges={pattern.pause_ranges}
                  onSubmit={input => void handleAmend(input)}
                  isSubmitting={amend.isPending}
                />
              ) : null}
            </>
          ) : null}

          {(pattern.status === 'declined' || pattern.status === 'withdrawn') &&
          canEditSchedule ? (
            <RestrictedActionButton
              testID="schedule-pending-build-cta"
              label={t('pending.emptyCta')}
              reason={closedReason}
              disabled={writeDisabled}
              onPress={() => router.push(BUILD_HREF)}
            />
          ) : null}

          {/* S9: an ended pattern used to be filtered out before this screen
              ever saw it, so the banner's "your usual week has ended" routed
              here to find "No schedule yet" — a truer state than an empty
              one, and its own CTA copy ("Set a new usual week") rather than
              reusing the declined/withdrawn "Build your week" wording. */}
          {pattern.status === 'ended' && canEditSchedule ? (
            <RestrictedActionButton
              testID="schedule-pending-build-cta"
              label={t('pending.setNewWeekCta')}
              reason={closedReason}
              disabled={writeDisabled}
              onPress={() => router.push(BUILD_HREF)}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

export function SchedulePendingScreen() {
  const { t } = useTranslation('schedule');
  const { t: tCommon } = useTranslation('common');
  // Same tab-bar dead-zone fix as Settings (BUG1) — this is the Schedule
  // tab's root for a parent with no accepted pattern.
  const tabBarScrollPadding = useTabBarScrollPadding();
  const { refreshControl } = usePullToRefresh();
  const router = useRouter();
  const currentUserId = useAuthStore(s => s.user?.id ?? null);

  const onboarding = useIsOnboarded();
  const patterns = useSchedulePatterns(onboarding.householdId);
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

  const canEditSchedule = isParentEditorRole(onboarding.role);
  // Additional gate, orthogonal to role: the household this pattern belongs
  // to may have closed (the employing parent deleted their account) since
  // this reader's own membership row was resolved. `canEditSchedule` still
  // decides WHO gets offered these actions at all (unchanged); this decides
  // whether the offered action stays disabled, with a reason, once closed.
  const canWriteHousehold = useCanWriteHousehold(onboarding.householdId);
  const closedReason =
    !canWriteHousehold.isLoading && !canWriteHousehold.canWrite
      ? tCommon('householdClosedReason')
      : null;

  // S7/S8: one section per carer, each resolved by its OWN precedence
  // (`resolvePerCarerPatterns`) — replaces the household-wide
  // `.find(p => p.status !== 'ended')` this screen used to run, which could
  // name one carer's pattern while a DIFFERENT carer's live week sat
  // unrepresented.
  const sections = resolvePerCarerPatterns(patterns.data ?? []);

  // C5 (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §C): a loading/error guard
  // must precede the role gate below — otherwise `onboarding.role` is still
  // null while onboarding resolves (or forever, on a failed read), and the
  // household's OWN parent is told this screen "isn't available to you".
  // Mirrors ScheduleBuildScreen.tsx's ordering (loading/error first, role
  // gate second).
  const onboardingQs = queryState(onboardingAsQuery(onboarding));
  if (onboardingQs.status === 'error') {
    return (
      <View testID="schedule-pending-screen" className="flex-1 bg-background">
        <ErrorState variant="network" onRetry={onboardingQs.retry} />
      </View>
    );
  }
  if (onboardingQs.status === 'loading') {
    return (
      <View
        testID="schedule-pending-screen"
        style={{ flex: 1 }}
        className="items-center justify-center bg-background"
      >
        <LoadingIndicator />
      </View>
    );
  }

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
        <View
          style={{
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
          }}
        >
          <BackButton
            testID="schedule-pending-not-available-back"
            onPress={() => router.back()}
            label={tCommon('back')}
          />
        </View>
        <View
          className="mt-8"
          style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
        >
          <EmptyState
            variant="inline"
            title={t('pending.notAvailableTitle')}
            description={t('pending.notAvailableDescription')}
          />
        </View>
      </View>
    );
  }

  // `onboarding.status === 'loading'` is already handled by the guard
  // above (which now precedes the role gate) — `patterns` is the one query
  // still in flight past that point.
  const isLoading = patterns.isLoading;

  return (
    <ScrollView
      testID="schedule-pending-screen"
      className="flex-1 bg-background"
      contentContainerStyle={{
        ...SCREEN_CONTENT_STYLE,
        paddingBottom: tabBarScrollPadding,
      }}
      refreshControl={refreshControl}
    >
      <BackButton
        testID="schedule-pending-back"
        onPress={() => router.back()}
        label={tCommon('back')}
      />
      <H1>{t('pending.screenTitle')}</H1>

      {isLoading ? (
        <LoadingIndicator messages={[t('pending.loading')]} />
      ) : patterns.isError ? (
        // False alarm: a failed patterns read fell through the same
        // `?? []` a genuinely-empty list does, showing "build a week"
        // over a real pending/accepted week the parent already sent.
        <View testID="schedule-pending-error" className="mt-6">
          <ErrorState variant="network" onRetry={() => patterns.refetch()} />
        </View>
      ) : sections.length === 0 ? (
        <View testID="schedule-pending-empty" className="mt-6 gap-4">
          <EmptyState
            variant="inline"
            image={illustrations.emptyPending}
            title={t('pending.emptyTitle')}
            description={t('pending.emptyBody')}
          />
          {canEditSchedule ? (
            <RestrictedActionButton
              testID="schedule-pending-build-cta"
              label={t('pending.emptyCta')}
              reason={closedReason}
              disabled={canWriteHousehold.isLoading}
              onPress={() => router.push(BUILD_HREF)}
            />
          ) : null}
        </View>
      ) : (
        <View className="mt-6 gap-6">
          {sections.map(section => (
            <SchedulePendingCarerSection
              key={section.carerId ?? 'no-carer'}
              pattern={section.pattern}
              carerName={resolveMemberDisplayName(
                section.carerId,
                currentUserId,
                membersByUserId,
                memberLabels
              )}
              canEditSchedule={canEditSchedule}
              childrenById={childrenById}
              showCarerLabel={sections.length > 1}
              closedReason={closedReason}
              writeDisabled={canWriteHousehold.isLoading}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
