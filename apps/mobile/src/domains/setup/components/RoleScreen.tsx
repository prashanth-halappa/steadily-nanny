/**
 * @module domains/setup/components/RoleScreen
 *
 * First screen after sign-in: fork on role. The choice is persisted to
 * `setupProgress` and drives which step sequence (parent vs nanny) the rest
 * of the flow follows — see `src/domains/setup/types`.
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

/**
 * UI-only selection for this screen, distinct from the persisted
 * `SetupRole`: the invite-code card has no role of its own — a co-parent
 * invited to an EXISTING household picks it to reach the same CODE step the
 * plain nanny card leads to (redeeming an invite there sets the real role
 * from the server, see `CodeEntryScreen`'s header comment). It still needs
 * its own highlight state, separate from the plain nanny card, hence the
 * wider local union instead of reusing `SetupRole` for `selected`.
 */
type RoleCardSelection = SetupRole | 'invite-code';

export function RoleScreen() {
  const { t } = useTranslation('auth');
  const router = useRouter();
  const [selected, setSelected] = useState<RoleCardSelection | null>(null);
  const setRole = useSetupProgressStore(s => s.setRole);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);

  const onContinue = () => {
    if (!selected) return;
    // Least invasive wiring: persist the nanny role for the invite-code card
    // too, so it falls through the SAME `stepsForRole` branch (ROLE -> CODE)
    // the plain nanny card uses — no new SetupRole/step needed.
    // CodeEntryScreen's `onJoin` overwrites this local value with the
    // redeemed membership's real role once it knows it (see this screen's
    // report note on CodeEntryScreen's existing nanny/helper-only
    // resolution — a co-parent invite is a pre-existing gap in that
    // mapping, not something this screen changes).
    const persistedRole: SetupRole =
      selected === 'invite-code' ? SETUP_ROLES.NANNY : selected;
    setRole(persistedRole);
    const nextStep =
      persistedRole === SETUP_ROLES.PARENT
        ? SETUP_STEPS.CHILDREN
        : SETUP_STEPS.CODE;
    setCurrentStep(nextStep);
    router.replace(getSetupStepRoute(nextStep) as Href);
  };

  return (
    <SetupScreenShell
      testID="role-screen"
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
      <RoleOptionCard
        testID="role-invite-code"
        title={t('onboarding.role.inviteCode.title')}
        description={t('onboarding.role.inviteCode.description')}
        selected={selected === 'invite-code'}
        onPress={() => setSelected('invite-code')}
      />
    </SetupScreenShell>
  );
}
