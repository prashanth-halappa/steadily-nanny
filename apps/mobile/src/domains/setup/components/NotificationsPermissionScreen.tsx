/**
 * @module domains/setup/components/NotificationsPermissionScreen
 *
 * Wizard step: every role sees this (parent, nanny, helper) — the last
 * shared step before the role-specific tail (calendar sync, parent/nanny
 * only) or the end of the wizard (helper). Priming happens up front via the
 * real OS prompt (`askForNotificationPermissions`); grant, deny, and error
 * ALL advance to the next step — permissions must never block onboarding.
 *
 * Showing this screen at all substitutes for the app's separate iOS
 * soft-ask primer (`NotificationSoftAskSheet`, `(private)/_layout.tsx`), so
 * mounting here records an attempt against `useNotificationStore` — the same
 * attempt/rate-limit counter the primer itself reads via `canPrompt()` —
 * rather than nagging a user again days later for something they already
 * saw during setup.
 */
import { type Href, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { illustrations } from '@/assets/illustrations';
import {
  getNextSetupStep,
  getSetupStepRoute,
  getStepProgress,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { askForNotificationPermissions } from '@/src/lib/pushNotification';
import { useNotificationStore } from '@/src/store/notificationStore';
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { SetupScreenShell } from './SetupScreenShell';

export function NotificationsPermissionScreen() {
  const router = useRouter();
  const { t } = useTranslation('auth');
  const role = useSetupProgressStore(s => s.role);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);
  const recordPrompt = useNotificationStore(s => s.recordPrompt);
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    // Record once, when this step is actually shown — not on every re-render.
    recordPrompt();
  }, [recordPrompt]);

  const advance = () => {
    const next = getNextSetupStep(role, SETUP_STEPS.NOTIFICATIONS_PERMISSION);
    if (next) {
      setCurrentStep(next);
      router.push(getSetupStepRoute(next) as Href);
      return;
    }
    router.replace('/(private)/(tabs)/home' as Href);
  };

  const onEnable = () => {
    setIsRequesting(true);
    void (async () => {
      try {
        await askForNotificationPermissions();
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
      heroImage={illustrations.onboardingNotifications}
      testID="notifications-permission-screen"
      progress={getStepProgress(role, SETUP_STEPS.NOTIFICATIONS_PERMISSION)}
      title={t('onboarding.notifications.title')}
      subtitle={t('onboarding.notifications.subtitle')}
      ctaLabel={t('onboarding.notifications.enableButton')}
      ctaDisabled={isRequesting}
      onCta={onEnable}
      onSkip={advance}
      skipLabel={t('onboarding.notifications.notNowButton')}
    />
  );
}
