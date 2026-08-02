import { QueryClient } from '@tanstack/react-query';
import { QUERY_TIMING } from '../hooks/queries/utils';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_TIMING.STALE_2M,
      gcTime: QUERY_TIMING.GC_5M,
      retry: 1, // Fail fast on mobile networks
      // D17: was `false` ("app-focus refetches are noisy + costly on RN"),
      // but that killed the ONLY thing that revalidates a screen the Tabs
      // navigator never remounts — `setupNetworkManagers` (src/lib/network.ts)
      // wires TanStack's focusManager to AppState specifically to enable
      // this, so leaving it off here silently disabled that wiring for every
      // query, app-wide. Chosen as the global fix (not a per-query override)
      // because the same staleness bug applies to every query, not just
      // useRunningTimeEntry, and the "noisy" worry doesn't hold up: a
      // focus refetch still only fires for a query whose own `staleTime` has
      // actually elapsed, so a quick app-switch-and-back — most real
      // foreground events — refetches nothing.
      refetchOnWindowFocus: true,
    },
  },
});
