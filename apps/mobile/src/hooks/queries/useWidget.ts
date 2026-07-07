import { useQuery } from '@tanstack/react-query';
import { widgetApi } from '@/src/api/endpoints/widgets';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * Fetch a single widget by id. Gated on an initialized session and a valid id.
 */
export function useWidget(widgetId: string) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.widget.byId(widgetId),
    queryFn: () => widgetApi.getById(widgetId),
    enabled: !!session && isInitialized && isValidId(widgetId),
    staleTime: QUERY_TIMING.STALE_2M,
    gcTime: QUERY_TIMING.GC_5M,
  });
}
