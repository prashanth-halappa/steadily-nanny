import { QueryClientContext } from '@tanstack/react-query';
import { useCallback, useContext, useState } from 'react';
import { RefreshControl } from 'react-native';
import { useThemeColors } from '@/lib/design-tokens';

/**
 * Shared pull-to-refresh hook for scrollable screens displaying server data.
 *
 * Provides `refreshing`, `onRefresh`, and a pre-configured `<RefreshControl />` element
 * styled with theme-aware design tokens (`mutedForeground` for iOS spinner tint,
 * `primary` for Android progress indicator).
 *
 * When triggered, it refetches all currently active queries (`type: 'active'`).
 * Refetching active queries targets only queries with mounted observers — i.e.,
 * exactly the server data the user is looking at right now — preventing redundant
 * network requests for unmounted screen data while guaranteeing fresh state on pull.
 *
 * Note: The query client is retrieved via `useContext(QueryClientContext)` instead of `useQueryClient()`.
 * `queryClient` is undefined ONLY outside a QueryClientProvider, i.e. in isolated component tests —
 * never in the real app, where a single QueryClientProvider wraps the entire tree at the root.
 * So the no-op branch in `onRefresh` is unreachable in production, and it exists so any screen using
 * pull-to-refresh can still be unit-rendered in isolation without throwing "No QueryClient set".
 */
export function usePullToRefresh() {
  const queryClient = useContext(QueryClientContext);
  const colors = useThemeColors();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    if (!queryClient) return;
    setRefreshing(true);
    try {
      await queryClient.refetchQueries({ type: 'active' });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  return {
    refreshing,
    onRefresh,
    refreshControl: (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        tintColor={colors.mutedForeground}
        colors={[colors.primary]}
      />
    ),
  };
}
