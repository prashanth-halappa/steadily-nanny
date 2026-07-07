/**
 * Query hook skeletons — read server state for `<feature>`.
 * One hook per file (see docs/08), so when you copy these, split them into
 * SEPARATE files:
 *   apps/mobile/src/hooks/queries/use<Feature>s.ts  — the list hook (useWidgets)
 *   apps/mobile/src/hooks/queries/use<Feature>.ts   — the single-item hook (useWidget)
 * They're shown together here only for reference.
 *
 * Wraps the endpoint module in TanStack Query. `enabled` gates the fetch until the
 * user is authenticated so it never fires with a missing token (which the axios
 * client would reject). Add the query key to the central factory first.
 *
 * In apps/mobile/src/api/queryKeys.ts add:
 *   widget: {
 *     all: ['widget'] as const,
 *     list: () => [...queryKeys.widget.all, 'list'] as const,
 *     byId: (id: string) => [...queryKeys.widget.all, id] as const,
 *   },
 */

import { useQuery } from '@tanstack/react-query';
import { widgetApi } from '../../api/endpoints/widgets';
import { queryKeys } from '../../api/queryKeys';
import { useAuthStore } from '../../store/auth';
import { QUERY_TIMING } from './utils';

export function useWidgets() {
  const { session, isInitialized } = useAuthStore();
  const enabled = !!session && isInitialized;

  return useQuery({
    queryKey: queryKeys.widget.list(),
    queryFn: widgetApi.list,
    enabled,
    staleTime: QUERY_TIMING.STALE_2M,
    gcTime: QUERY_TIMING.GC_5M,
  });
}

export function useWidget(widgetId: string) {
  const { session, isInitialized } = useAuthStore();
  const enabled = !!session && isInitialized && !!widgetId;

  return useQuery({
    queryKey: queryKeys.widget.byId(widgetId),
    queryFn: () => widgetApi.getById(widgetId),
    enabled,
    staleTime: QUERY_TIMING.STALE_2M,
    gcTime: QUERY_TIMING.GC_5M,
  });
}
