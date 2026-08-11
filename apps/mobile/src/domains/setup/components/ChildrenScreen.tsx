/**
 * @module domains/setup/components/ChildrenScreen
 *
 * Parent · create, step 2: add/edit/remove children.
 *
 * The household is named on `HouseholdScreen` now (the HOUSEHOLD step, spec
 * §3.3), which is also where it is normally created. The auto-create effect
 * below SURVIVES as the fallback, and deliberately: a returning parent who
 * signs out mid-wizard reaches this screen with a household on the server but
 * nothing in local wizard state, and a parent who somehow arrives here with
 * neither still needs children to have somewhere to go. It creates a household
 * under a default name rather than blocking; renaming lives in Settings.
 *
 * A parent on the JOIN path must never reach this screen — creating a
 * household here would hand them a second, empty family beside the one they
 * just redeemed into. `stepsFor` keeps CHILDREN out of the join sequence; the
 * redirect below is the belt to that braces, for a deep link or a stale route.
 */
import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { ChildrenManager } from '@/src/domains/setup/components/ChildrenManager';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import {
  getSetupStepRoute,
  getStepProgress,
  SETUP_PATHS,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useCreateHousehold } from '@/src/hooks/mutations/useCreateHousehold';
import { useUpsertProfile } from '@/src/hooks/mutations/useUpsertProfile';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { buildBootstrapProfileRequest } from '@/src/lib/bootstrapUserProfile';
import { getDeviceCurrency, getDeviceRegion } from '@/src/lib/deviceLocale';
import { getDeviceTimeZone } from '@/src/lib/deviceTimeZone';
import { useAuthStore } from '@/src/store/auth';
import { useSetupProgressStore } from '@/src/store/setupProgress';

const DEFAULT_HOUSEHOLD_NAME = 'Our household';

export function ChildrenScreen() {
  const router = useRouter();
  const session = useAuthStore(s => s.session);
  const role = useSetupProgressStore(s => s.role);
  const path = useSetupProgressStore(s => s.path);
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

  const householdId = households.data?.[0]?.id ?? cachedHouseholdId ?? null;

  // A joining parent has no business creating a household. Bounce before the
  // bootstrap effect below can fire.
  useEffect(() => {
    if (path !== SETUP_PATHS.JOIN) return;
    setCurrentStep(SETUP_STEPS.CODE);
    router.replace(getSetupStepRoute(SETUP_STEPS.CODE) as Href);
  }, [path, setCurrentStep, router]);

  useEffect(() => {
    if (path === SETUP_PATHS.JOIN) return;
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
            // No name field here any more — this is the fallback path, and it
            // only runs for someone who never saw HouseholdScreen. A default
            // they can rename beats a wizard that refuses to move.
            name: DEFAULT_HOUSEHOLD_NAME,
            // Device-derived prefills, same "seed, never final word" discipline
            // as `PaySetupScreen`'s currency chip — a parent can correct both
            // from Settings -> Manage household afterward. `jurisdiction` is
            // deliberately absent: expo-localization only gives country-level
            // region, never a US state, so there is nothing honest to prefill.
            timezone: getDeviceTimeZone(),
            currency: getDeviceCurrency(),
            // D-8: a US-region device gets a Sunday-start pay week; every
            // other region keeps the SQL default (1, Monday) by omission.
            // The engine doesn't read this yet (3-E1) — sending it now
            // avoids a second onboarding touch when it does.
            ...(getDeviceRegion() === 'US' ? { week_starts_on: 0 } : {}),
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
    path,
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
      progress={getStepProgress(role, path, SETUP_STEPS.CHILDREN)}
      title={t('children.wizardTitle')}
      subtitle={t('children.wizardSubtitle')}
      ctaLabel={t('children.continueButton')}
      ctaDisabled={isLoadingHousehold || !hasAtLeastOneChild}
      onCta={onContinue}
    >
      {isLoadingHousehold ? (
        // The fallback window: a household is being created under a default
        // name because this user never passed through HOUSEHOLD. No inputs
        // here any more — a name field that appears only for as long as a
        // network call takes is not a place to ask someone to type.
        <View className="gap-4">
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
