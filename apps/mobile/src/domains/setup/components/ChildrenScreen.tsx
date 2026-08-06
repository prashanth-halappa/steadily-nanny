/**
 * @module domains/setup/components/ChildrenScreen
 *
 * Parent setup step 2: add/edit/remove children. A household must exist
 * before children can be created (`POST /households`), so this screen
 * auto-creates one on first entry if the parent has none yet — there's no
 * separate "name your household" step in Wave 1, so it gets a sensible
 * default name the parent can rename later from settings.
 */
import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { ChildrenManager } from '@/src/domains/setup/components/ChildrenManager';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { getSetupStepRoute, SETUP_STEPS } from '@/src/domains/setup/types';
import { useCreateHousehold } from '@/src/hooks/mutations/useCreateHousehold';
import { useUpsertProfile } from '@/src/hooks/mutations/useUpsertProfile';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { buildBootstrapProfileRequest } from '@/src/lib/bootstrapUserProfile';
import { useAuthStore } from '@/src/store/auth';
import { useSetupProgressStore } from '@/src/store/setupProgress';

const DEFAULT_HOUSEHOLD_NAME = 'Our household';

export function ChildrenScreen() {
  const router = useRouter();
  const session = useAuthStore(s => s.session);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);
  const cachedHouseholdId = useSetupProgressStore(s => s.householdId);

  const setHouseholdId = useSetupProgressStore(s => s.setHouseholdId);
  const households = useHouseholds();
  const profile = useUserProfile();
  const upsertProfile = useUpsertProfile();
  const createHousehold = useCreateHousehold();
  // Guard so bootstrap runs at most once per mount (reset only on full failure).
  const bootstrapStartedRef = useRef(false);

  const householdId = households.data?.[0]?.id ?? cachedHouseholdId ?? null;

  useEffect(() => {
    if (!households.isSuccess) return;

    if (households.data.length === 0) {
      const authUser = session?.user;
      if (!authUser) return;
      if (
        bootstrapStartedRef.current ||
        createHousehold.isPending ||
        upsertProfile.isPending
      ) {
        return;
      }
      if (profile.isPending) return;

      const profileExists = Boolean(profile.data?.user_id);

      bootstrapStartedRef.current = true;

      void (async () => {
        try {
          if (!profileExists) {
            await upsertProfile.mutateAsync(
              buildBootstrapProfileRequest(authUser)
            );
          }
          await createHousehold.mutateAsync({ name: DEFAULT_HOUSEHOLD_NAME });
        } catch {
          bootstrapStartedRef.current = false;
        }
      })();
      return;
    }

    // Adopt an EXISTING household into setupProgress — a returning parent
    // who signs out and back in reaches this screen with a household already
    // on the server but nothing cached locally (setupProgress is wiped on
    // sign-out); without this, InviteScreen reads a null householdId forever
    // and its effect guard never fires. Don't leave this only on the create
    // path's onSuccess.
    const existingId = households.data[0]?.id;
    if (existingId && existingId !== cachedHouseholdId) {
      setHouseholdId(existingId);
    }
  }, [
    households.isSuccess,
    households.data,
    cachedHouseholdId,
    setHouseholdId,
    session?.user,
    profile.isPending,
    profile.data,
    createHousehold.isPending,
    createHousehold.mutateAsync,
    upsertProfile.isPending,
    upsertProfile.mutateAsync,
  ]);

  const children = useChildren(householdId);
  const { t } = useTranslation('household');

  const onContinue = () => {
    setCurrentStep(SETUP_STEPS.INVITE);
    router.push(getSetupStepRoute(SETUP_STEPS.INVITE) as Href);
  };

  const isLoadingHousehold = !householdId;
  // Gated on >= 1 child, matching useIsOnboarded's server-derived predicate
  // (parent onboarded == owns a household with >= 1 child) — letting Continue
  // through with zero children would let a parent "finish" the wizard in a
  // state the app itself doesn't consider onboarded, and the next cold start
  // would bounce them right back here.
  const hasAtLeastOneChild = (children.data?.length ?? 0) > 0;

  return (
    <SetupScreenShell
      testID="children-screen"
      progress={1 / 3}
      title={t('children.wizardTitle')}
      subtitle={t('children.wizardSubtitle')}
      ctaLabel={t('children.continueButton')}
      ctaDisabled={isLoadingHousehold || !hasAtLeastOneChild}
      onCta={onContinue}
    >
      {isLoadingHousehold ? (
        <LoadingIndicator />
      ) : (
        <ChildrenManager householdId={householdId} />
      )}
    </SetupScreenShell>
  );
}
