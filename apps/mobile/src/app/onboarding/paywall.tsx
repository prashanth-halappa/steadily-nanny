import { OnboardingScreenShell } from '@/src/domains/onboarding';
import { usePaywall } from '@/src/domains/subscription';
import { useOnboardingNavigation } from '@/src/hooks/navigation/useOnboardingNavigation';

export default function OnboardingPaywall() {
  const { completeAndAdvance } = useOnboardingNavigation();
  const { presentPaywall } = usePaywall();

  const upgrade = async () => {
    await presentPaywall('onboarding');
    completeAndAdvance('PAYWALL');
  };

  return (
    <OnboardingScreenShell
      progress={1}
      title="Unlock everything"
      subtitle="Go Pro to get the full experience."
      ctaLabel="See plans"
      onCta={() => void upgrade()}
      onSkip={() => completeAndAdvance('PAYWALL')}
    />
  );
}
