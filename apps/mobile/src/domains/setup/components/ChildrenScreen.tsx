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
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { FieldLabel } from '@/src/components/ui/field-label';
import { Input } from '@/src/components/ui/input';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { ChildrenManager } from '@/src/domains/setup/components/ChildrenManager';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import {
  getSetupStepRoute,
  getStepProgress,
  SETUP_ROLES,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
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
  // Surfaced on bootstrap failure so the parent isn't stranded on an infinite
  // spinner with no way forward; `retryBootstrap` clears it, which — being in
  // the effect's deps — re-triggers the attempt.
  const [bootstrapFailed, setBootstrapFailed] = useState(false);
  // Optional, typed while the bootstrap create-household call is in flight
  // (the input only renders during that window — see `isLoadingHousehold`
  // below). Empty stays empty; the bootstrap effect falls back to
  // `DEFAULT_HOUSEHOLD_NAME` itself, same as before this field existed.
  const [householdName, setHouseholdName] = useState('');

  const householdId = households.data?.[0]?.id ?? cachedHouseholdId ?? null;

  useEffect(() => {
    if (!households.isSuccess) return;

    if (households.data.length === 0) {
      const authUser = session?.user;
      if (!authUser) return;
      // `bootstrapFailed` MUST be read here in the body, not just listed as a
      // dep: retry works by clearing it, and an unused ("extra") dependency is
      // exactly what `biome check --unsafe` — which `bun run format` runs —
      // deletes. The first version of this retry relied on the extra dep and
      // was silently broken by the format pass; the failed state also means
      // we deliberately hold the attempt while the error screen is up.
      if (bootstrapFailed) return;
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
          await createHousehold.mutateAsync({
            name: householdName.trim() || DEFAULT_HOUSEHOLD_NAME,
          });
        } catch {
          bootstrapStartedRef.current = false;
          setBootstrapFailed(true);
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
    bootstrapFailed,
    householdName,
  ]);

  const children = useChildren(householdId);
  const { t } = useTranslation('household');

  const onContinue = () => {
    setCurrentStep(SETUP_STEPS.INVITE);
    router.push(getSetupStepRoute(SETUP_STEPS.INVITE) as Href);
  };

  const retryBootstrap = () => {
    bootstrapStartedRef.current = false;
    setBootstrapFailed(false);
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
      progress={getStepProgress(SETUP_ROLES.PARENT, SETUP_STEPS.CHILDREN)}
      title={t('children.wizardTitle')}
      subtitle={t('children.wizardSubtitle')}
      ctaLabel={t('children.continueButton')}
      ctaDisabled={isLoadingHousehold || !hasAtLeastOneChild}
      onCta={onContinue}
    >
      {isLoadingHousehold ? (
        <View className="gap-4">
          {/* Visible for the whole create-household window (including a
              failed/retrying attempt) — this is the only chance to set it,
              the bootstrap create call fires automatically and there's no
              separate "name your household" step in Wave 1 (see this
              module's header comment). Renaming after the fact happens from
              Settings -> Manage household instead. */}
          <View className="gap-2">
            <FieldLabel>{t('children.householdNameLabel')}</FieldLabel>
            <Input
              testID="household-name-input"
              accessibilityLabel={t('children.householdNameLabel')}
              value={householdName}
              onChangeText={setHouseholdName}
              placeholder={t('children.householdNamePlaceholder')}
              autoCapitalize="words"
            />
          </View>
          {bootstrapFailed ? (
            <ErrorState variant="generic" onRetry={retryBootstrap} />
          ) : (
            <LoadingIndicator />
          )}
        </View>
      ) : (
        <ChildrenManager householdId={householdId} />
      )}
    </SetupScreenShell>
  );
}
