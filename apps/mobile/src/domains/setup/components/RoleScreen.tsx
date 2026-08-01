/**
 * @module domains/setup/components/RoleScreen
 *
 * First screen after sign-in: fork on role. The choice is persisted to
 * `setupProgress` and drives which step sequence (parent vs nanny) the rest
 * of the flow follows — see `src/domains/setup/types`.
 */
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
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
  const router = useRouter();
  const [selected, setSelected] = useState<SetupRole | null>(null);
  const setRole = useSetupProgressStore(s => s.setRole);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);

  const onContinue = () => {
    if (!selected) return;
    setRole(selected);
    const nextStep =
      selected === SETUP_ROLES.PARENT ? SETUP_STEPS.CHILDREN : SETUP_STEPS.CODE;
    setCurrentStep(nextStep);
    router.replace(getSetupStepRoute(nextStep) as Href);
  };

  return (
    <SetupScreenShell
      testID="role-screen"
      title="Who are you?"
      subtitle="This sets up the right steps for you."
      ctaLabel="Continue"
      ctaDisabled={!selected}
      onCta={onContinue}
    >
      <RoleOptionCard
        testID="role-parent"
        title="I'm a parent"
        description="Set up your household, add your children, and invite your nanny."
        selected={selected === SETUP_ROLES.PARENT}
        onPress={() => setSelected(SETUP_ROLES.PARENT)}
      />
      <RoleOptionCard
        testID="role-nanny"
        title="I'm a nanny"
        description="Join a household with an invite code and set your availability."
        selected={selected === SETUP_ROLES.NANNY}
        onPress={() => setSelected(SETUP_ROLES.NANNY)}
      />
    </SetupScreenShell>
  );
}
