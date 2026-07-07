/**
 * network.ts
 *
 * Bridges device connectivity into TanStack Query so the app behaves correctly
 * offline: queries pause while offline and refetch automatically on reconnect,
 * and a global banner can reflect the state.
 *
 * - onlineManager ← NetInfo (connected AND internet reachable)
 * - focusManager  ← AppState (foreground = focused), enabling refetch-on-focus
 *
 * Call setupNetworkManagers() once at app start.
 */

import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

export function setupNetworkManagers(): void {
  // Safe to call more than once: setEventListener replaces the prior listener
  // (and runs its cleanup), so there's no listener leak on Fast Refresh.
  onlineManager.setEventListener(setOnline => {
    return NetInfo.addEventListener(state => {
      // isInternetReachable can be null (unknown) early on — only treat an
      // explicit false as offline so we don't flap to offline on a fresh start.
      const online =
        Boolean(state.isConnected) && state.isInternetReachable !== false;
      setOnline(online);
    });
  });

  focusManager.setEventListener(setFocused => {
    const subscription = AppState.addEventListener('change', status => {
      setFocused(status === 'active');
    });
    return () => subscription.remove();
  });
}

/**
 * Subscribe to online/offline state for UI (e.g. the offline banner).
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    onlineManager.subscribe.bind(onlineManager),
    () => onlineManager.isOnline(),
    () => true
  );
}
