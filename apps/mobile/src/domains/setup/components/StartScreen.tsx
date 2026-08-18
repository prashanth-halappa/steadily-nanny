/**
 * @module domains/setup/components/StartScreen
 *
 * The start fork (D-33, spec §3.2) — "How are you starting?". Same component
 * vocabulary as `RoleScreen`, two cards, and deliberately NO hero
 * illustration: two screens in a row with a 160px hero reads as a brochure
 * (§15).
 *
 * BOTH cards exist for BOTH roles. That symmetry is the whole of D-33: a
 * nanny can author her own terms draft and invite a family to it, and a parent
 * can join a family that already exists. Only the "create" card's description
 * changes with the role.
 */
import { HOUSEHOLD_STATES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  entryStepFor,
  getSetupStepRoute,
  SETUP_PATHS,
  SETUP_ROLES,
  SETUP_STEPS,
  type SetupPath,
} from '@/src/domains/setup/types';
import { useCreateHousehold } from '@/src/hooks/mutations/useCreateHousehold';
import { getDeviceCurrency } from '@/src/lib/deviceLocale';
import { getDeviceTimeZone } from '@/src/lib/deviceTimeZone';
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { RoleOptionCard } from './RoleOptionCard';
import { SetupScreenShell } from './SetupScreenShell';

export function StartScreen() {
  const { t } = useTranslation('auth');
  const router = useRouter();
  const role = useSetupProgressStore(s => s.role);
  const setPath = useSetupProgressStore(s => s.setPath);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);
  const createHousehold = useCreateHousehold();
  const [selected, setSelected] = useState<SetupPath | null>(null);

  const onContinue = () => {
    if (!selected) return;
    setPath(selected);
    const next = entryStepFor(role, selected);

    const advance = () => {
      setCurrentStep(next);
      router.replace(getSetupStepRoute(next) as Href);
    };

    // B0: a nanny who authors terms needs a draft household id before
    // DraftTermsScreen's Save CTA (`canSave = … && !!householdId`) can fire.
    // No `name` — migration 093's CHECK forbids one on a draft; the schema
    // refine allows the omission only when `state === 'draft'`.
    if (role === SETUP_ROLES.NANNY && selected === SETUP_PATHS.CREATE) {
      void (async () => {
        try {
          await createHousehold.mutateAsync({
            state: HOUSEHOLD_STATES.DRAFT,
            timezone: getDeviceTimeZone(),
            currency: getDeviceCurrency(),
          });
          advance();
        } catch {
          // `useCreateHousehold` toasts its own failure; staying put IS the
          // retry affordance.
        }
      })();
      return;
    }

    advance();
  };

  // `replace`, not `back()`: RoleScreen navigates here with `replace`, so it
  // is no longer on the stack to go back to. `setCurrentStep` rewinds the
  // persisted progress too, so a resume after a kill mid-fork lands back on
  // ROLE rather than re-launching straight into START.
  const onBack = () => {
    setCurrentStep(SETUP_STEPS.ROLE);
    router.replace(getSetupStepRoute(SETUP_STEPS.ROLE) as Href);
  };

  const createDescription =
    role === SETUP_ROLES.NANNY
      ? t('onboarding.start.create.descriptionNanny')
      : t('onboarding.start.create.descriptionParent');

  return (
    <SetupScreenShell
      testID="start-screen"
      // No progress bar — see RoleScreen. The sequence length is still one
      // answer away, and this screen is that answer.
      onBack={onBack}
      backLabel={t('common:back')}
      title={t('onboarding.start.title')}
      subtitle={t('onboarding.start.subtitle')}
      ctaLabel={t('common:continue')}
      ctaDisabled={!selected}
      onCta={onContinue}
    >
      <RoleOptionCard
        testID="start-create"
        title={t('onboarding.start.create.title')}
        description={createDescription}
        selected={selected === SETUP_PATHS.CREATE}
        onPress={() => setSelected(SETUP_PATHS.CREATE)}
      />
      <RoleOptionCard
        testID="start-join"
        title={t('onboarding.start.join.title')}
        description={t('onboarding.start.join.description')}
        selected={selected === SETUP_PATHS.JOIN}
        onPress={() => setSelected(SETUP_PATHS.JOIN)}
      />
    </SetupScreenShell>
  );
}
