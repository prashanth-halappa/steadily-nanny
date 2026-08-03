import '@/polyfills'; // AI-SDK/streaming shims — MUST be first
import '@/global.css'; // NativeWind base styles
import '@/lib/icons/registry'; // register lucide icons for className support
import '@/src/i18n'; // initialize i18next

import { PortalHost } from '@rn-primitives/portal';
import * as Sentry from '@sentry/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { PostHogProvider } from 'posthog-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ToastManager from 'toastify-react-native';
import { useThemeColors } from '@/lib/design-tokens';
import { queryClient } from '@/src/api/queryClient';
import {
  AnimatedSplash,
  AppBootstrap,
  AppGate,
  RootErrorBoundary,
} from '@/src/components/custom';
import { env, validateEnv } from '@/src/config/env';
import {
  AnalyticsProvider,
  createDefaultPlugins,
  posthogClient,
} from '@/src/lib/analytics';
import { setupNetworkManagers } from '@/src/lib/network';
import { configureForegroundHandler } from '@/src/lib/pushNotification';
import { useAuthStore } from '@/src/store/auth';

// Module-scope init — runs before the component tree mounts.
Sentry.init({
  dsn: env.sentryDsn,
  // Never send PII (IPs, auth headers). Mask replays.
  sendDefaultPii: false,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.mobileReplayIntegration({ maskAllText: true, maskAllImages: true }),
  ],
});
configureForegroundHandler();
SplashScreen.preventAutoHideAsync();
validateEnv();
setupNetworkManagers();

const analyticsPlugins = createDefaultPlugins();

function RootLayout() {
  const initializeAuth = useAuthStore(s => s.initializeAuth);
  const cleanupAuth = useAuthStore(s => s.cleanupAuth);
  const themeColors = useThemeColors();
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    initializeAuth();
    void SplashScreen.hideAsync();
    return () => cleanupAuth();
  }, [initializeAuth, cleanupAuth]);

  return (
    <RootErrorBoundary>
      {/* Root themed shell uses inline backgroundColor (not a bg-* className) so a
          theme toggle can't race the navigation context. */}
      <View style={{ flex: 1, backgroundColor: themeColors.background }}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <QueryClientProvider client={queryClient}>
              <PostHogProvider
                client={posthogClient ?? undefined}
                autocapture={false}
              >
                <AnalyticsProvider plugins={analyticsPlugins}>
                  {/* AppSyncSlot — generic remote-config / push / billing sync.
                      EXTEND-HERE: add product headless sync components here. */}
                  <AppBootstrap />
                  <AppGate>
                    <SafeAreaView style={{ flex: 1 }} edges={['left', 'right']}>
                      <Stack screenOptions={{ headerShown: false }} />
                    </SafeAreaView>
                  </AppGate>
                  <PortalHost />
                  <ToastManager />
                  {/* Inside QueryClientProvider so AnimatedSplash can read
                      useIsOnboarded and hold until routing is decidable. */}
                  {splashDone ? null : (
                    <AnimatedSplash onFinish={() => setSplashDone(true)} />
                  )}
                </AnalyticsProvider>
              </PostHogProvider>
            </QueryClientProvider>
          </SafeAreaProvider>
        </GestureHandlerRootView>
        <StatusBar style="dark" />
      </View>
    </RootErrorBoundary>
  );
}

export default Sentry.wrap(RootLayout);
