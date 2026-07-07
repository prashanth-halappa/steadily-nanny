import { OnboardingScreenShell } from '@/src/domains/onboarding';
import { useOnboardingNavigation } from '@/src/hooks/navigation/useOnboardingNavigation';
import { registerForPushNotificationsAsync } from '@/src/lib/pushNotification';

export default function OnboardingNotifications() {
  const { completeAndAdvance } = useOnboardingNavigation();

  const enable = async () => {
    await registerForPushNotificationsAsync();
    completeAndAdvance('NOTIFICATIONS');
  };

  return (
    <OnboardingScreenShell
      progress={0.66}
      title="Stay in the loop"
      subtitle="Turn on notifications for timely reminders. You can change this anytime in Settings."
      ctaLabel="Enable notifications"
      onCta={() => void enable()}
      onSkip={() => completeAndAdvance('NOTIFICATIONS')}
    />
  );
}
