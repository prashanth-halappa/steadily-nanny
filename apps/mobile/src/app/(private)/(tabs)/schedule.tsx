/**
 * @module app/(private)/(tabs)/schedule
 *
 * Role-aware Schedule tab. Nannies see this week's materialised shifts
 * (no back — they're at tab root). Parents and helpers see the household's
 * schedule-pattern state via SchedulePendingScreen.
 *
 * `useIsOnboarded().role` is null in THREE distinct situations, which this
 * screen must not conflate — that conflation used to render a permanent
 * spinner with no retry affordance for the latter two:
 *   1. memberships are still loading (`status === 'loading'`)        -> spinner
 *   2. the memberships query itself errored                          -> ErrorState + retry
 *   3. the user genuinely has no household membership yet             -> EmptyState
 *
 * `useMyMemberships` is read directly here, alongside `useIsOnboarded`,
 * purely for its `isError`/`refetch` — same query key, so this is a second
 * subscriber to the already-cached query, not an extra network call.
 * `useIsOnboarded` remains the single choke point for role/status.
 *
 * Sub-routes (`/schedule/build`, `/schedule/shifts`,
 * `/schedule/respond/[patternId]`) live under `(private)/schedule/` one
 * segment deeper and do not collide with this tab route.
 */

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import {
  SchedulePendingScreen,
  ScheduleShiftsScreen,
} from '@/src/domains/schedule';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useMyMemberships } from '@/src/hooks/queries/useMyMemberships';

export default function ScheduleRoute() {
  const { t } = useTranslation('schedule');
  const onboarding = useIsOnboarded();
  const membershipsQuery = useMyMemberships();

  if (onboarding.status === 'loading') {
    return <LoadingIndicator testID="schedule-tab-loading" />;
  }

  if (onboarding.role === null) {
    if (membershipsQuery.isError) {
      return (
        <View testID="schedule-tab-error" style={{ flex: 1 }}>
          <ErrorState
            onRetry={() => {
              void membershipsQuery.refetch();
            }}
          />
        </View>
      );
    }

    return (
      <View testID="schedule-tab-empty" style={{ flex: 1 }}>
        <EmptyState
          variant="inline"
          title={t('tab.emptyTitle')}
          description={t('tab.emptyDescription')}
        />
      </View>
    );
  }

  if (onboarding.role === SETUP_ROLES.NANNY) {
    return <ScheduleShiftsScreen showBack={false} />;
  }

  return <SchedulePendingScreen />;
}
