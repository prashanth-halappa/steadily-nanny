/**
 * @module domains/setup/components/CalendarPermissionScreen
 *
 * Wizard step: parent and nanny only (helper's `stepsForRole` sequence ends
 * at notifications — nothing to schedule around as a read-only viewer), and
 * the LAST step for both, same finishing role InviteScreen/AvailabilityScreen
 * used to carry alone. Grant, deny, and error ALL advance — permissions must
 * never block onboarding. On grant, also turns sync on against a default
 * calendar (`enableDefaultCalendarSync`) so it actually starts, mirroring
 * `TimeSettingsScreen.handleToggle`'s grant path without the manual picker.
 */
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { illustrations } from '@/assets/illustrations';
import {
  enableDefaultCalendarSync,
  requestCalendarPermissions,
} from '@/src/domains/schedule/utils/calendarSyncNative';
import {
  getNextSetupStep,
  getSetupStepRoute,
  getStepProgress,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { SetupScreenShell } from './SetupScreenShell';

export function CalendarPermissionScreen() {
  const router = useRouter();
  const { t } = useTranslation('auth');
  const role = useSetupProgressStore(s => s.role);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);
  const resetSetupProgress = useSetupProgressStore(s => s.reset);
  const [isRequesting, setIsRequesting] = useState(false);

  const advance = () => {
    const next = getNextSetupStep(role, SETUP_STEPS.CALENDAR_PERMISSION);
    if (next) {
      setCurrentStep(next);
      router.push(getSetupStepRoute(next) as Href);
      return;
    }
    resetSetupProgress();
    router.replace('/(private)/(tabs)/home' as Href);
  };

  const onEnable = () => {
    setIsRequesting(true);
    void (async () => {
      try {
        const { granted } = await requestCalendarPermissions();
        if (granted) {
          await enableDefaultCalendarSync();
        }
      } catch {
        // Grant, deny, or failure — never block onboarding on this.
      } finally {
        setIsRequesting(false);
        advance();
      }
    })();
  };

  return (
    <SetupScreenShell
      heroImage={illustrations.onboardingCalendar}
      testID="calendar-permission-screen"
      progress={getStepProgress(role, SETUP_STEPS.CALENDAR_PERMISSION)}
      title={t('onboarding.calendar.title')}
      subtitle={t('onboarding.calendar.subtitle')}
      ctaLabel={t('onboarding.calendar.enableButton')}
      ctaDisabled={isRequesting}
      onCta={onEnable}
      onSkip={advance}
      skipLabel={t('onboarding.calendar.notNowButton')}
    />
  );
}
