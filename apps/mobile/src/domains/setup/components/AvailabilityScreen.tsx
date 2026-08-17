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
 *
 * THE SKIP IS SAFE. `useIsOnboarded`'s server-derived predicate reports an
 * active nanny membership as onboarded on the membership alone — availability
 * rows are not part of it (`isOnboardedForMembership`). So "Set this up later"
 * can advance the wizard without writing a single row and nobody gets stranded
 * in a resume loop; it takes the same step transition Finish does, which is
 * what keeps `getUnfinishedSetupResumeRoute` from pointing back here.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Small } from '@/src/components/ui/typography';
import { AvailabilityEditor } from '@/src/domains/setup/components/AvailabilityEditor';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import {
  getSetupStepRoute,
  getStepProgress,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useAvailability } from '@/src/hooks/queries/useAvailability';
import { useSetupProgressStore } from '@/src/store/setupProgress';

export function AvailabilityScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const role = useSetupProgressStore(s => s.role);
  const path = useSetupProgressStore(s => s.path);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);

  const availability = useAvailability();
  const selectedDays = (availability.data ?? [])
    .filter(row => row.is_available)
    .map(row => row.weekday);

  // Skip and Finish take the SAME transition — the only difference is that
  // skipping leaves the availability table empty, which the onboarded
  // predicate does not care about (see the module note).
  const goToNotifications = () => {
    setCurrentStep(SETUP_STEPS.NOTIFICATIONS_PERMISSION);
    router.push(
      getSetupStepRoute(SETUP_STEPS.NOTIFICATIONS_PERMISSION) as Href
    );
  };

  return (
    <SetupScreenShell
      testID="availability-screen"
      progress={getStepProgress(role, path, SETUP_STEPS.AVAILABILITY)}
      title={t('availability.wizardTitle')}
      subtitle={t('availability.wizardSubtitle')}
      ctaLabel={t('availability.finishButton')}
      ctaDisabled={selectedDays.length === 0}
      onCta={goToNotifications}
      onSkip={goToNotifications}
      skipLabel={t('availability.skipButton')}
    >
      <AvailabilityEditor />
      {/* Both lines sit at the bottom of the scroll body, directly above the
          pinned CTA. `text-muted-strong`, not `text-muted-foreground`: this
          sits on the screen wash, where the lighter token fails contrast. */}
      {selectedDays.length === 0 ? (
        <Small
          testID="availability-cta-reason"
          className="text-center text-muted-strong"
        >
          {t('availability.finishBlockedReason')}
        </Small>
      ) : null}
      <Small
        testID="availability-skip-reassurance"
        className="text-center text-muted-strong"
      >
        {t('availability.skipReassurance')}
      </Small>
    </SetupScreenShell>
  );
}
