import { QueryClient } from '@tanstack/react-query';
import { QUERY_TIMING } from '../hooks/queries/utils';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_TIMING.STALE_2M,
      gcTime: QUERY_TIMING.GC_5M,
      retry: 1, // Fail fast on mobile networks
      refetchOnWindowFocus: false, // App-focus refetches are noisy + costly on RN
    },
  },
});
