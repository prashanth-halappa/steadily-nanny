/**
 * @module app/(private)/(tabs)/schedule
 *
 * Role-aware Schedule tab. Nannies always land on the week calendar.
 * Parents/helpers ALSO always land on the calendar now — pattern status
 * (none / draft / pending / declined / withdrawn / accepted) is a banner
 * above it, never a full-screen takeover. A full-screen
 * `SchedulePendingScreen` used to hide the calendar (and any still-live
 * shifts, one-off shifts, and the "Add a one-off shift" button) for every
 * state except `accepted` — see `SchedulePatternBanner` for the per-state
 * banner and `/(private)/schedule/usual-week` for the pushed detail screen.
 */

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import {
  SchedulePatternBanner,
  ScheduleShiftsScreen,
} from '@/src/domains/schedule';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useSchedulePatterns } from '@/src/hooks/queries/useSchedulePatterns';

export default function ScheduleRoute() {
  const { t } = useTranslation('schedule');
  const onboarding = useIsOnboarded();
  const patterns = useSchedulePatterns(
    onboarding.role !== SETUP_ROLES.NANNY ? onboarding.householdId : null
  );

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
          image={illustrations.emptySchedule}
          title={t('tab.emptyTitle')}
          description={t('tab.emptyDescription')}
        />
      </View>
    );
  }

  if (onboarding.role === SETUP_ROLES.NANNY) {
    return <ScheduleShiftsScreen showBack={false} />;
  }

  const pattern = (patterns.data ?? []).find(p => p.status !== 'ended') ?? null;

  return (
    <ScheduleShiftsScreen
      showBack={false}
      patternBanner={
        <SchedulePatternBanner
          pattern={pattern}
          householdId={onboarding.householdId}
          isLoading={patterns.isLoading}
        />
      }
    />
  );
}
