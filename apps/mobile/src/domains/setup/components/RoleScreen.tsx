/**
 * @module domains/setup/components/RoleScreen
 *
 * First screen after sign-in: fork on ROLE, and only on role. The choice is
 * persisted to `setupProgress` and the user goes on to the START fork
 * (`StartScreen`), which asks the second, orthogonal question.
 *
 * The third "I have an invite code" card is deliberately gone (D-33, spec
 * §3.1). It was never a role — it was a path, and the screen knew it: a local
 * `RoleCardSelection` union existed purely to give it a highlight, and it
 * persisted `SETUP_ROLES.NANNY` as wiring convenience, which made a co-parent
 * joining an existing family a "nanny" to the local wizard until
 * `CodeEntryScreen` corrected it from the redeemed membership. Joining is now
 * a path available to BOTH roles.
 */
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { illustrations } from '@/assets/illustrations';
import type { SetupRole } from '@/src/domains/setup/types';
import {
  getSetupStepRoute,
  SETUP_ROLES,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { RoleOptionCard } from './RoleOptionCard';
import { SetupScreenShell } from './SetupScreenShell';

export function RoleScreen() {
  const { t } = useTranslation('auth');
  const router = useRouter();
  const [selected, setSelected] = useState<SetupRole | null>(null);
  const setRole = useSetupProgressStore(s => s.setRole);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);

  const onContinue = () => {
    if (!selected) return;
    // `role` first and `path` NOT here: `app/onboarding/_layout.tsx` reads
    // `role !== null` as `wizardEngaged`, and that predicate is what keeps an
    // onboarded-mid-wizard user from being bounced home. See its header.
    setRole(selected);
    setCurrentStep(SETUP_STEPS.START);
    router.replace(getSetupStepRoute(SETUP_STEPS.START) as Href);
  };

  return (
    <SetupScreenShell
      testID="role-screen"
      // No progress bar on either fork screen. The denominator is the length
      // of a sequence neither question has picked yet — parent·create is 7
      // steps, helper is 4 — so any fraction shown here is a guess the bar
      // would have to walk back the moment the user answers.
      heroImage={illustrations.onboardingRole}
      title={t('onboarding.role.title')}
      subtitle={t('onboarding.role.subtitle')}
      ctaLabel={t('common:continue')}
      ctaDisabled={!selected}
      onCta={onContinue}
    >
      <RoleOptionCard
        testID="role-parent"
        title={t('onboarding.role.parent.title')}
        description={t('onboarding.role.parent.description')}
        selected={selected === SETUP_ROLES.PARENT}
        onPress={() => setSelected(SETUP_ROLES.PARENT)}
      />
      <RoleOptionCard
        testID="role-nanny"
        title={t('onboarding.role.nanny.title')}
        description={t('onboarding.role.nanny.description')}
        selected={selected === SETUP_ROLES.NANNY}
        onPress={() => setSelected(SETUP_ROLES.NANNY)}
      />
    </SetupScreenShell>
  );
}
