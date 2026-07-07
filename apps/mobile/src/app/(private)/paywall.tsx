import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { presentPaywall } from '@/src/domains/subscription';

/**
 * Full-screen-modal paywall route. Presents the native paywall (guarded by the
 * App Store 2.1a readiness check) and dismisses itself afterwards.
 */
export default function PaywallRoute() {
  const router = useRouter();

  useEffect(() => {
    void (async () => {
      await presentPaywall('paywall-route');
      if (router.canGoBack()) router.back();
    })();
  }, [router]);

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <LoadingIndicator />
    </View>
  );
}
