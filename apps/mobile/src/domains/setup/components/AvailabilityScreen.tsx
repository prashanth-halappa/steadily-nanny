/**
 * @module domains/setup/components/AvailabilityScreen
 *
 * Nanny setup step 2 of 4: pick which weekdays you're available, and a
 * time window per selected day. The weekday/time-range editing body lives
 * in `AvailabilityEditor`, shared with the post-onboarding settings entry
 * point (`ManageAvailabilityScreen`) — this screen only owns the wizard's
 * "Finish" gating (>= 1 selected day). NOT the last wizard step — advances
 * to NOTIFICATIONS_PERMISSION, same as InviteScreen advancing on the parent
 * side. See `getNextSetupStep` in `domains/setup/types`.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AvailabilityEditor } from '@/src/domains/setup/components/AvailabilityEditor';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import {
  getSetupStepRoute,
  getStepProgress,
  SETUP_ROLES,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useAvailability } from '@/src/hooks/queries/useAvailability';
import { useSetupProgressStore } from '@/src/store/setupProgress';

export function AvailabilityScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);

  const availability = useAvailability();
  const selectedDays = (availability.data ?? [])
    .filter(row => row.is_available)
    .map(row => row.weekday);

  const onFinish = () => {
    setCurrentStep(SETUP_STEPS.NOTIFICATIONS_PERMISSION);
    router.push(
      getSetupStepRoute(SETUP_STEPS.NOTIFICATIONS_PERMISSION) as Href
    );
  };

  return (
    <SetupScreenShell
      testID="availability-screen"
      progress={getStepProgress(SETUP_ROLES.NANNY, SETUP_STEPS.AVAILABILITY)}
      title={t('availability.wizardTitle')}
      subtitle={t('availability.wizardSubtitle')}
      ctaLabel={t('availability.finishButton')}
      ctaDisabled={selectedDays.length === 0}
      onCta={onFinish}
    >
      <AvailabilityEditor />
    </SetupScreenShell>
  );
}
