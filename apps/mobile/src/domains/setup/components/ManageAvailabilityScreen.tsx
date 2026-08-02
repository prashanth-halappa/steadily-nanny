/**
 * @module domains/setup/components/ManageAvailabilityScreen
 *
 * Post-onboarding entry point (Settings -> Availability): a nanny could
 * never change her availability again once first-run setup was done —
 * `AvailabilityScreen` was only reachable mid-wizard, even though
 * `ScheduleBuildScreen` reads that availability every time a parent builds
 * a week. Reuses `AvailabilityEditor` (which already saves each edit
 * immediately — see its header comment) inside `SetupScreenShell` with no
 * progress bar and a CTA that just returns to wherever the nanny came from.
 */
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AvailabilityEditor } from '@/src/domains/setup/components/AvailabilityEditor';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';

export function ManageAvailabilityScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const { t: tCommon } = useTranslation('common');

  return (
    <SetupScreenShell
      testID="manage-availability-screen"
      title={t('availability.manageTitle')}
      subtitle={t('availability.manageSubtitle')}
      ctaLabel={t('availability.doneButton')}
      onCta={() => router.back()}
      onBack={() => router.back()}
      backLabel={tCommon('back')}
    >
      <AvailabilityEditor />
    </SetupScreenShell>
  );
}
