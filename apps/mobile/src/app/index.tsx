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

  // Route once per IDENTITY, not once per mount.
  //
  // This was a one-shot `useRef(false)` and it stranded every user who signed
  // in. Cold start renders this screen, it routes to /welcome, and the ref
  // flips true. Signing in then fires the auth store's SIGNED_IN handler, which
  // calls `router.replace('/')` — landing back on this SAME still-mounted
  // component, where the one-shot guard early-returns and no second routing
  // decision is ever made. The result is a permanent LoadingIndicator with a
  // valid session sitting behind it.
  //
  // Keying on the user id keeps the original intent (don't re-route on every
  // render) while still reacting to signed-out -> signed-in and account
  // switches. `undefined` means "no decision yet" and is deliberately distinct
  // from `null`, which means "we have decided this user is signed out".
  const routedForUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isInitialized) return;

    const userId = session?.user?.id ?? null;
    if (routedForUserId.current === userId) return;

    if (!session) {
      // During cold start the API token can be set a tick before the Zustand
      // session hydrates — wait instead of bouncing the user to /welcome.
      // Deliberately do NOT record a decision here; we haven't made one yet.
      if (hasAuthToken()) return;
      routedForUserId.current = null;
      router.replace('/welcome' as Href);
      return;
    }

    routedForUserId.current = userId;
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
