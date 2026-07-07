import { OnboardingScreenShell } from '@/src/domains/onboarding';
import { useOnboardingNavigation } from '@/src/hooks/navigation/useOnboardingNavigation';

export default function OnboardingWelcome() {
  const { completeAndAdvance } = useOnboardingNavigation();
  return (
    <OnboardingScreenShell
      progress={0}
      title="Welcome"
      subtitle="A few quick steps to set things up."
      ctaLabel="Get started"
      onCta={() => completeAndAdvance('WELCOME')}
    />
  );
}
