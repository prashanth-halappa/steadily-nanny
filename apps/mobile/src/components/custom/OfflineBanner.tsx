/**
 * OfflineBanner
 *
 * Thin global banner shown when the device loses connectivity, so failed actions
 * read as "you're offline" instead of silently erroring. Driven by TanStack's
 * onlineManager via useIsOnline (wired to NetInfo in setupNetworkManagers).
 */

import { WifiOff } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { useIsOnline } from '@/src/lib/network';

export function OfflineBanner() {
  const isOnline = useIsOnline();
  if (isOnline) return null;

  return (
    <View
      testID="offline-banner"
      className="flex-row items-center justify-center gap-2 bg-muted px-4 py-2"
    >
      <Icon icon={WifiOff} size={14} className="text-muted-foreground" />
      <Text className="text-xs text-muted-foreground">
        You're offline — changes will retry when you reconnect.
      </Text>
    </View>
  );
}
