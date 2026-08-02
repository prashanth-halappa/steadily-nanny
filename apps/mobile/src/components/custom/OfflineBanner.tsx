/**
 * OfflineBanner
 *
 * Thin global banner shown when the device loses connectivity, so failed actions
 * read as "you're offline" instead of silently erroring. Driven by TanStack's
 * onlineManager via useIsOnline (wired to NetInfo in setupNetworkManagers).
 *
 * Wave 4 CX: "Retry now" forces a NetInfo re-check and invalidates queries so
 * pending work can resume without waiting for the next OS connectivity event.
 */

import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { WifiOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { queryClient } from '@/src/api/queryClient';
import { useIsOnline } from '@/src/lib/network';

export function OfflineBanner() {
  const { t } = useTranslation('common');
  const isOnline = useIsOnline();
  if (isOnline) return null;

  const handleRetry = () => {
    void NetInfo.fetch().then(state => {
      const online =
        Boolean(state.isConnected) && state.isInternetReachable !== false;
      onlineManager.setOnline(online);
      if (online) {
        void queryClient.invalidateQueries();
      }
    });
  };

  return (
    <View
      testID="offline-banner"
      className="flex-row items-center justify-center gap-2 bg-muted px-4 py-2"
    >
      <Icon icon={WifiOff} size={14} className="text-muted-foreground" />
      <Text className="text-xs text-muted-foreground">
        {t('offlineBanner')}
      </Text>
      <Pressable
        testID="offline-banner-retry"
        accessibilityRole="button"
        accessibilityLabel={t('retry')}
        onPress={handleRetry}
        hitSlop={8}
      >
        <Text className="text-xs text-primary font-sora-medium">
          {t('retryNow')}
        </Text>
      </Pressable>
    </View>
  );
}
