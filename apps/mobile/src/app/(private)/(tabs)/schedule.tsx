/**
 * @module app/(private)/(tabs)/schedule
 *
 * Role-aware Schedule tab. Nannies always land on the week calendar.
 * Parents/helpers with an accepted usual week also land on the calendar
 * (pattern status is a banner); otherwise SchedulePendingScreen covers
 * empty / draft / pending / declined.
 */

import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, Small } from '@/src/components/ui/typography';
import {
  SchedulePendingScreen,
  ScheduleShiftsScreen,
} from '@/src/domains/schedule';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useSchedulePatterns } from '@/src/hooks/queries/useSchedulePatterns';

export default function ScheduleRoute() {
  const { t } = useTranslation('schedule');
  const router = useRouter();
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

  if (pattern?.status === 'accepted') {
    return (
      <ScheduleShiftsScreen
        showBack={false}
        patternBanner={
          <View
            testID="schedule-pattern-banner"
            className="flex-row items-center justify-between gap-2 rounded-row bg-card px-3 py-2"
          >
            <Small className="flex-1 text-muted-foreground">
              {t('pending.patternBannerAccepted')}
            </Small>
            <Pressable
              testID="schedule-pattern-banner-change"
              accessibilityRole="button"
              onPress={() => router.push('/(private)/schedule/build' as Href)}
            >
              <Body className="text-primary">
                {t('pending.patternBannerChange')}
              </Body>
            </Pressable>
          </View>
        }
      />
    );
  }

  return <SchedulePendingScreen />;
}
