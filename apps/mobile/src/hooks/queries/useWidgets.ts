import { useQuery } from '@tanstack/react-query';
import { widgetApi } from '@/src/api/endpoints/widgets';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * List the caller's widgets. Gated on an initialized session so it never fires
 * tokenless (which the axios client would reject).
 */
export function useWidgets() {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.widget.list(),
    queryFn: widgetApi.list,
    enabled: !!session && isInitialized,
    staleTime: QUERY_TIMING.STALE_2M,
    gcTime: QUERY_TIMING.GC_5M,
  });
}
