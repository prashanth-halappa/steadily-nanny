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
 *
 * THE GATE IS `useHasActiveMembership`, NOT `useIsOnboarded().isPastMember`.
 * The write behind this screen (`PUT /v1/availability/me`) is USER-scoped, so
 * the server accepts it from a nanny no family employs any more — this was not
 * a refused write producing an error toast, it was a real row saved into a
 * household nobody would ever read it for. And the household-scoped flag is
 * the wrong question in both directions here, because `carer_availability`
 * carries no household id: it is ONE availability shared across every family
 * she works for. A nanny with one ended family and one live one has
 * `isPastMember: true` whenever the ended household is the resolved one, and
 * gating on that would lock the only screen where she keeps her real working
 * days up to date. See that hook's header for the full reasoning.
 */
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { AvailabilityEditor } from '@/src/domains/setup/components/AvailabilityEditor';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { useHasActiveMembership } from '@/src/hooks/queries/useHasActiveMembership';

export function ManageAvailabilityScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const { t: tCommon } = useTranslation('common');
  const { t: tHours } = useTranslation('hours');
  const { hasActiveMembership, isLoading } = useHasActiveMembership();

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
      {isLoading ? (
        <LoadingIndicator testID="manage-availability-loading" />
      ) : hasActiveMembership ? (
        <AvailabilityEditor />
      ) : (
        // `EmptyState` takes no testID of its own — same wrapper TimeOffScreen
        // uses for its refusal.
        <View testID="manage-availability-read-only">
          <EmptyState
            variant="inline"
            title={tCommon('readOnlyBadge')}
            description={tHours('pastMemberNote')}
          />
        </View>
      )}
    </SetupScreenShell>
  );
}
