import { Stack } from 'expo-router';
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
import { LegalGateOverlay } from '@/src/domains/legal/components/LegalGateOverlay';
import { useSignedOutRedirect } from '@/src/hooks/useSignedOutRedirect';
import { useAuthStore } from '@/src/store/auth';
import { useNotificationStore } from '@/src/store/notificationStore';

/**
 * Auth-gated subtree. Redirects to /welcome when there is no session
 * (`useSignedOutRedirect`, shared with `app/onboarding/_layout.tsx`).
 *
 * `isOnboarded` for THIS gate is a session check only; the entry router
 * (app/index.tsx) sends un-onboarded users into the onboarding flow. Swap in a
 * different predicate (e.g. useIsOnboarded) if you want to gate here too.
 */
export default function PrivateLayout() {
  useSignedOutRedirect();
  const isInitialized = useAuthStore(s => s.isInitialized);
  const session = useAuthStore(s => s.session);
  const canPrompt = useNotificationStore(s => s.canPrompt);
  const [showSoftAsk, setShowSoftAsk] = useState(false);

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

      <LegalGateOverlay />

      <AnnouncementModal />
      <NotificationSoftAskSheet
        visible={showSoftAsk}
        onDismiss={() => setShowSoftAsk(false)}
      />
    </SafeAreaView>
  );
}
