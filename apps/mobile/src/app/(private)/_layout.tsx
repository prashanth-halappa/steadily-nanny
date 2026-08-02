import { type Href, Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AnnouncementModal,
  NotificationSoftAskSheet,
  OfflineBanner,
  SoftUpdateBanner,
} from '@/src/components/custom';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { useAuthStore } from '@/src/store/auth';
import { useNotificationStore } from '@/src/store/notificationStore';

/**
 * Auth-gated subtree. Redirects to /welcome when there is no session.
 *
 * `isOnboarded` for THIS gate is a session check only; the entry router
 * (app/index.tsx) sends un-onboarded users into the onboarding flow. Swap in a
 * different predicate (e.g. useIsOnboarded) if you want to gate here too.
 */
export default function PrivateLayout() {
  const router = useRouter();
  const isInitialized = useAuthStore(s => s.isInitialized);
  const session = useAuthStore(s => s.session);
  const canPrompt = useNotificationStore(s => s.canPrompt);
  const [showSoftAsk, setShowSoftAsk] = useState(false);

  useEffect(() => {
    if (isInitialized && !session) router.replace('/welcome' as Href);
  }, [isInitialized, session, router]);

  // iOS soft-ask primer: iOS only, once the primer cadence allows.
  useEffect(() => {
    if (Platform.OS === 'ios' && session && canPrompt()) {
      const timer = setTimeout(() => setShowSoftAsk(true), 1500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [session, canPrompt]);

  // Stable BLOCK state (no session) may unmount the Stack. PORTING/remount-loop
  // lesson: never unmount <Stack> during TRANSIENT loading (e.g. a re-consent
  // gate) — that caused a "Maximum update depth exceeded" navigator remount loop.
  // Keep the Stack mounted under a loading overlay for those cases instead.
  if (!isInitialized || !session) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <LoadingIndicator />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <OfflineBanner />
      <SoftUpdateBanner />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>

      {/* RE-CONSENT GATE EXTENSION POINT — v1 slim omits the legal re-consent
          gate. PORTING: gate on a route-INDEPENDENT `enabled`, and keep <Stack>
          mounted under a loading overlay (never unmount it mid-load). */}

      <AnnouncementModal />
      <NotificationSoftAskSheet
        visible={showSoftAsk}
        onDismiss={() => setShowSoftAsk(false)}
      />
    </SafeAreaView>
  );
}
