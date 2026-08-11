/**
 * @module domains/setup/components/HouseholdScreen
 *
 * Parent · create, step 1 (spec §3.3): name the family and yourself, then
 * create the household.
 *
 * WHY THIS SCREEN EXISTS. Both inputs used to live inside `ChildrenScreen`,
 * rendered ONLY while the auto-create call was in flight (`isLoadingHousehold`)
 * — a window measured in network latency, not a screen. Whether a parent got
 * to name their own family depended on how fast the API answered. The create
 * is now an explicit act on an explicit screen.
 *
 * `ChildrenScreen` keeps its auto-create effect as a FALLBACK: a returning
 * parent who signs out mid-wizard lands there with a server-side household and
 * no local wizard state, and that path must still work. This screen is where a
 * name is TYPED; that one is where a household is guaranteed to EXIST.
 */
import { type Href, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { FieldLabel } from '@/src/components/ui/field-label';
import { Input } from '@/src/components/ui/input';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import {
  getSetupStepRoute,
  getStepProgress,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useCreateHousehold } from '@/src/hooks/mutations/useCreateHousehold';
import { useUpsertProfile } from '@/src/hooks/mutations/useUpsertProfile';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import {
  buildBootstrapProfileRequest,
  deriveBootstrapName,
} from '@/src/lib/bootstrapUserProfile';
import { getDeviceCurrency, getDeviceRegion } from '@/src/lib/deviceLocale';
import { getDeviceTimeZone } from '@/src/lib/deviceTimeZone';
import { useAuthStore } from '@/src/store/auth';
import { useSetupProgressStore } from '@/src/store/setupProgress';

export function HouseholdScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const session = useAuthStore(s => s.session);
  const role = useSetupProgressStore(s => s.role);
  const path = useSetupProgressStore(s => s.path);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);
  const setHouseholdId = useSetupProgressStore(s => s.setHouseholdId);

  const households = useHouseholds();
  const profile = useUserProfile();
  const upsertProfile = useUpsertProfile();
  const createHousehold = useCreateHousehold();

  const existing = households.data?.[0] ?? null;

  const [householdName, setHouseholdName] = useState('');
  const [displayName, setDisplayName] = useState(() => {
    const user = session?.user;
    return user ? deriveBootstrapName(user) : '';
  });

  // Adopt an existing household's name into the field once the list resolves.
  // A parent who signed out mid-wizard comes back to a household that already
  // exists on the server; showing them an empty box would read as "your family
  // is gone". `name` is nullable only for a nanny-authored draft, which a
  // parent never owns — `?? ''` here is the empty-box case, not a draft.
  useEffect(() => {
    if (existing) setHouseholdName(current => current || (existing.name ?? ''));
  }, [existing]);

  const trimmedHouseholdName = householdName.trim();
  const canContinue = trimmedHouseholdName.length > 0;

  const advance = () => {
    setCurrentStep(SETUP_STEPS.CHILDREN);
    router.push(getSetupStepRoute(SETUP_STEPS.CHILDREN) as Href);
  };

  const onContinue = () => {
    if (!canContinue || createHousehold.isPending) return;

    // Already have one: adopt it rather than minting a second family. The
    // rename path is Settings -> Manage household, not a PATCH from the wizard.
    if (existing) {
      setHouseholdId(existing.id);
      advance();
      return;
    }

    const authUser = session?.user;
    if (!authUser) return;

    void (async () => {
      try {
        if (!profile.data?.user_id) {
          await upsertProfile.mutateAsync(
            buildBootstrapProfileRequest(authUser, { name: displayName.trim() })
          );
        }
        await createHousehold.mutateAsync({
          name: trimmedHouseholdName,
          // Device-derived prefills, same "seed, never final word" discipline
          // as `PaySetupScreen`'s currency chip — correctable from Settings ->
          // Manage household. `jurisdiction` is deliberately absent:
          // expo-localization only gives country-level region, never a US
          // state, so there is nothing honest to prefill.
          timezone: getDeviceTimeZone(),
          currency: getDeviceCurrency(),
          // D-8: a US-region device gets a Sunday-start pay week; every other
          // region keeps the SQL default (1, Monday) by omission.
          ...(getDeviceRegion() === 'US' ? { week_starts_on: 0 } : {}),
        });
        advance();
      } catch {
        // `useCreateHousehold`/`useUpsertProfile` each toast their own failure;
        // staying put with the typed names intact IS the retry affordance.
      }
    })();
  };

  // `replace`, not `back()` — StartScreen navigated here with `replace`.
  const onBack = () => {
    router.replace(getSetupStepRoute(SETUP_STEPS.START) as Href);
  };

  return (
    <SetupScreenShell
      testID="household-screen"
      progress={getStepProgress(role, path, SETUP_STEPS.HOUSEHOLD)}
      onBack={onBack}
      backLabel={t('common:back')}
      title={t('setup.wizardTitle')}
      subtitle={t('setup.wizardSubtitle')}
      ctaLabel={t('setup.continueButton')}
      ctaDisabled={!canContinue || createHousehold.isPending}
      onCta={onContinue}
    >
      <View className="gap-2">
        <FieldLabel>{t('setup.parentNameLabel')}</FieldLabel>
        <Input
          testID="parent-name-input"
          accessibilityLabel={t('setup.parentNameLabel')}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={t('setup.parentNamePlaceholder')}
          autoCapitalize="words"
        />
      </View>
      <View className="gap-2">
        <FieldLabel>{t('setup.householdNameLabel')}</FieldLabel>
        <Input
          testID="household-name-input"
          accessibilityLabel={t('setup.householdNameLabel')}
          value={householdName}
          onChangeText={setHouseholdName}
          placeholder={t('setup.householdNamePlaceholder')}
          autoCapitalize="words"
        />
      </View>
    </SetupScreenShell>
  );
}
