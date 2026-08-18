/**
 * @module domains/schedule/components/NannyUsualWeekScreen
 *
 * S11: a nanny had NO pattern-level surface at all — she could accept a
 * usual week and never see it again, and was never told when one was
 * withdrawn (no push type existed). This is her read-only "Your usual
 * week" view, one per household (`householdId` — a nanny can work for
 * more than one, so this is never her only-household).
 *
 * Route: `/(private)/schedule/usual-week?householdId=` — the SAME route
 * the parent's pattern banner pushes, forked by role in the route file
 * (`SchedulePendingScreen` is parent/helper-only and resolves its household
 * from `useActiveHousehold`, which only ever answers for a single
 * household; this screen resolves its household from the query param via
 * `useHouseholdById`, the Pattern A detail-screen rule).
 *
 * Read-only: no withdraw, no adjust, no respond — those live on
 * `ScheduleRespondScreen` (pending) and are otherwise parent-only. This is
 * purely "what does my usual week with this family look like right now".
 */
import type { SchedulePatternStatus } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { BackButton } from '@/src/components/ui/back-button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { PatternStatusIndicator } from '@/src/domains/schedule/components/PatternStatusIndicator';
import { SchedulePatternPreview } from '@/src/domains/schedule/components/SchedulePatternPreview';
import { resolveActivePattern } from '@/src/domains/schedule/utils/patternPrecedence';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholdById } from '@/src/hooks/queries/useHouseholdById';
import { useSchedulePattern } from '@/src/hooks/queries/useSchedulePattern';
import { useSchedulePatterns } from '@/src/hooks/queries/useSchedulePatterns';
import { useAuthStore } from '@/src/store/auth';

/** Neither of these is "hers" to see: a draft is unsent, and only a
 * pending/accepted/declined/withdrawn/ended row was ever addressed to her. */
const NOT_YET_HERS: ReadonlySet<SchedulePatternStatus> = new Set(['draft']);

export function NannyUsualWeekScreen() {
  const { t } = useTranslation('schedule');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const tabBarScrollPadding = useTabBarScrollPadding();
  const { refreshControl } = usePullToRefresh();
  const params = useLocalSearchParams<{ householdId?: string }>();
  const householdId =
    typeof params.householdId === 'string' && params.householdId.length > 0
      ? params.householdId
      : null;
  const currentUserId = useAuthStore(s => s.user?.id ?? null);

  const household = useHouseholdById(householdId);
  const patterns = useSchedulePatterns(householdId);
  const children = useChildren(householdId);
  const childrenById = new Map(
    (children.data ?? []).map(c => [
      c.id,
      { id: c.id, name: c.name, colour: c.colour },
    ])
  );

  const myPatterns = (patterns.data ?? []).filter(
    p => p.carer_id === currentUserId && !NOT_YET_HERS.has(p.status)
  );
  const pattern = resolveActivePattern(myPatterns);
  const detail = useSchedulePattern(pattern ? pattern.id : null);

  const familyName = household.household?.name ?? '';
  const isLoading = household.isLoading || patterns.isLoading;

  if (household.notMember) {
    return (
      <View testID="nanny-usual-week-not-member" style={{ flex: 1 }}>
        <ErrorState
          variant="notFound"
          title={tCommon('deepLink.notMember.title')}
          message={tCommon('deepLink.notMember.message')}
          secondaryLabel={tCommon('deepLink.notMember.action')}
          onSecondaryAction={() => router.back()}
        />
      </View>
    );
  }

  return (
    <ScrollView
      testID="nanny-usual-week-screen"
      className="flex-1 bg-background"
      contentContainerStyle={{
        ...SCREEN_CONTENT_STYLE,
        paddingBottom: tabBarScrollPadding,
      }}
      refreshControl={refreshControl}
    >
      <BackButton
        testID="nanny-usual-week-back"
        onPress={() => router.back()}
        label={tCommon('back')}
      />
      <H1>{t('usualWeek.screenTitle')}</H1>

      {isLoading || patterns.isError ? (
        patterns.isError ? (
          <View testID="nanny-usual-week-error" className="mt-6">
            <ErrorState variant="network" onRetry={() => patterns.refetch()} />
          </View>
        ) : (
          <LoadingIndicator messages={[t('pending.loading')]} />
        )
      ) : !pattern ? (
        <View testID="nanny-usual-week-empty" className="mt-6">
          <EmptyState
            variant="inline"
            title={t('usualWeek.emptyTitle', { family: familyName })}
            description={t('usualWeek.emptyBody', { family: familyName })}
          />
        </View>
      ) : (
        <View className="mt-6 gap-4">
          <PatternStatusIndicator
            testID="nanny-usual-week-status"
            status={
              pattern.status === 'accepted' ||
              pattern.status === 'declined' ||
              pattern.status === 'withdrawn' ||
              pattern.status === 'ended'
                ? pattern.status
                : 'pending'
            }
          />
          {pattern.status === 'withdrawn' ? (
            <Body
              testID="nanny-usual-week-withdrawn"
              className="text-muted-foreground"
            >
              {t('usualWeek.withdrawnTitle', { family: familyName })}
            </Body>
          ) : null}
          {pattern.status === 'ended' ? (
            <Body
              testID="nanny-usual-week-ended"
              className="text-muted-foreground"
            >
              {t('usualWeek.endedTitle', { family: familyName })}
            </Body>
          ) : null}
          {pattern.status === 'declined' ? (
            <Body
              testID="nanny-usual-week-declined"
              className="text-muted-foreground"
            >
              {t('usualWeek.declinedTitle', { family: familyName })}
            </Body>
          ) : null}
          {pattern.until ? (
            <Small
              testID="nanny-usual-week-until"
              className="text-muted-foreground"
            >
              {t('pending.untilLine', {
                end: formatDisplayDate(pattern.until),
              })}
            </Small>
          ) : null}
          {detail.data && detail.data.days.length > 0 ? (
            <SchedulePatternPreview
              testID="nanny-usual-week-preview"
              days={detail.data.days}
              childrenById={childrenById}
              until={pattern.until}
              exdates={pattern.exdates}
              pauseRanges={pattern.pause_ranges}
            />
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}
