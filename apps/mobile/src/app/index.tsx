import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { hasAuthToken } from '@/src/api/client';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { getStepRoute } from '@/src/config/onboardingFlows';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useAuthStore } from '@/src/store/auth';
import { useOnboardingStore } from '@/src/store/onboarding';
import { usePendingDeepLinkStore } from '@/src/store/pendingDeepLinkStore';

/**
 * Entry router — decides where to send the user, exactly once.
 */
export default function Index() {
  const router = useRouter();
  const isInitialized = useAuthStore(s => s.isInitialized);
  const session = useAuthStore(s => s.session);
  const isOnboarded = useIsOnboarded();
  const currentStep = useOnboardingStore(s => s.currentStep);
  const hasRouted = useRef(false);

  useEffect(() => {
    if (hasRouted.current || !isInitialized) return;

    if (!session) {
      // During cold start the API token can be set a tick before the Zustand
      // session hydrates — wait instead of bouncing the user to /welcome.
      if (hasAuthToken()) return;
      hasRouted.current = true;
      router.replace('/welcome' as Href);
      return;
    }

    hasRouted.current = true;
    if (!isOnboarded) {
      router.replace(getStepRoute(currentStep) as Href);
      return;
    }

    // Replay a queued deep link (from a push tap while logged out), else tabs.
    const pending = usePendingDeepLinkStore.getState().consumePendingLink();
    router.replace((pending ?? '/(private)/(tabs)/home') as Href);
  }, [isInitialized, session, isOnboarded, currentStep, router]);

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <LoadingIndicator />
    </View>
  );
}
