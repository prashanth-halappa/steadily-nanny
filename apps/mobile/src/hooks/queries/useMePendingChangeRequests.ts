/**
 * @module hooks/queries/useMePendingChangeRequests
 *
 * Cross-household pending change requests awaiting my response —
 * GET /me/change-requests. Prefer this over N parallel listForShift calls
 * (inbox / NeedsAttentionCard).
 */
import { useQuery } from '@tanstack/react-query';
import { meApi } from '@/src/api/endpoints/me';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useMePendingChangeRequests(
  from: string | undefined,
  to: string | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);
  const enabled = !!session && isInitialized && !!from && !!to;

  return useQuery({
    queryKey: queryKeys.me.changeRequests(from, to),
    queryFn: () =>
      meApi.listPendingChangeRequests(from as string, to as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled,
  });
}
