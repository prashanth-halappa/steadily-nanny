/**
 * @module domains/setup/components/AvailabilityScreen
 *
 * Nanny setup step 2 (final): pick which weekdays you're available, and a
 * time window per selected day. The weekday/time-range editing body lives
 * in `AvailabilityEditor`, shared with the post-onboarding settings entry
 * point (`ManageAvailabilityScreen`) — this screen only owns the wizard's
 * "Finish" gating (>= 1 selected day) and return-to-Home behavior.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AvailabilityEditor } from '@/src/domains/setup/components/AvailabilityEditor';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { useAvailability } from '@/src/hooks/queries/useAvailability';

export function AvailabilityScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');

  const availability = useAvailability();
  const selectedDays = (availability.data ?? [])
    .filter(row => row.is_available)
    .map(row => row.weekday);

  const onFinish = () => {
    // No local "complete" flag to flip — useIsOnboarded is server-derived
    // and already reads a nanny with an active membership as onboarded.
    router.replace('/(private)/(tabs)/home' as Href);
  };

  return (
    <SetupScreenShell
      testID="availability-screen"
      progress={1}
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
