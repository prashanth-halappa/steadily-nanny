/**
 * @module domains/setup/components/ManageChildrenScreen
 *
 * Post-onboarding entry point (Settings -> Manage children): a parent
 * cannot otherwise add, edit, or remove a child once first-run setup is
 * done — `ChildrenScreen` was only ever reachable mid-wizard. Reuses
 * `SetupScreenShell` without a progress bar and with the CTA wired to
 * `router.back()` instead of "next step", following the same precedent as
 * `ScheduleBuildScreen`'s review step for a standalone (non-wizard) screen
 * built on the shell.
 *
 * Household comes from the server-derived `useIsOnboarded`, never the
 * in-flight `setupProgress` store — that store is wizard UI state and can be
 * empty for an account that was onboarded on another device or seeded
 * directly (see `useIsOnboarded`'s header comment).
 */
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { ChildrenManager } from '@/src/domains/setup/components/ChildrenManager';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';

export function ManageChildrenScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const { t: tCommon } = useTranslation('common');
  const onboarding = useIsOnboarded();

  return (
    <SetupScreenShell
      testID="manage-children-screen"
      title={t('children.manageTitle')}
      subtitle={t('children.manageSubtitle')}
      ctaLabel={t('children.doneButton')}
      onCta={() => router.back()}
      onBack={() => router.back()}
      backLabel={tCommon('back')}
    >
      {onboarding.householdId ? (
        <ChildrenManager householdId={onboarding.householdId} />
      ) : (
        <LoadingIndicator />
      )}
    </SetupScreenShell>
  );
}
