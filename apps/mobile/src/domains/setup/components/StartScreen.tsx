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
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { RoleOptionCard } from './RoleOptionCard';
import { SetupScreenShell } from './SetupScreenShell';

export function StartScreen() {
  const { t } = useTranslation('auth');
  const router = useRouter();
  const role = useSetupProgressStore(s => s.role);
  const setPath = useSetupProgressStore(s => s.setPath);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);
  const [selected, setSelected] = useState<SetupPath | null>(null);

  const onContinue = () => {
    if (!selected) return;
    setPath(selected);
    const next = entryStepFor(role, selected);
    setCurrentStep(next);
    router.replace(getSetupStepRoute(next) as Href);
  };

  // `replace`, not `back()`: RoleScreen navigates here with `replace`, so it
  // is no longer on the stack to go back to.
  const onBack = () => {
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
