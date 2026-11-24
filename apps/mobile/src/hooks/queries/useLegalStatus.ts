/** @module hooks/queries/useLegalStatus — signed-in user's legal acceptance status. */
import { useQuery } from '@tanstack/react-query';
import { legalApi } from '@/src/api/endpoints/legal';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';

export interface UseLegalStatusOptions {
  enabled: boolean;
}

/**
 * Fetches whether the signed-in user has accepted the current legal version.
 * Callers pass `enabled` (typically whether the user is signed in).
 */
export function useLegalStatus({ enabled }: UseLegalStatusOptions) {
  return useQuery({
    queryKey: queryKeys.legal.status(),
    queryFn: legalApi.getStatus,
    enabled,
    staleTime: QUERY_TIMING.STALE_5M,
  });
}
