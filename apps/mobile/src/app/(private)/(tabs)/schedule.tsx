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
 * `useIsOnboarded` reports an errored memberships query as `status: 'loading'`
 * PLUS `membershipsError: true` (unknown must fail toward WAIT, not toward
 * ASSUME NEW USER — see that hook's header comment). So the `membershipsError`
 * check MUST run before the `status === 'loading'` check here, or the error
 * gets swallowed into an indefinite spinner. `useIsOnboarded` now surfaces
 * `membershipsError`/`retryMemberships` itself, so there's no need for a
 * second `useMyMemberships` subscription just to read `isError`/`refetch`.
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

export default function ScheduleRoute() {
  const { t } = useTranslation('schedule');
  const onboarding = useIsOnboarded();

  if (onboarding.membershipsError) {
    return (
      <View testID="schedule-tab-error" style={{ flex: 1 }}>
        <ErrorState onRetry={onboarding.retryMemberships} />
      </View>
    );
  }

  if (onboarding.status === 'loading') {
    return <LoadingIndicator testID="schedule-tab-loading" />;
  }

  if (onboarding.role === null) {
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
