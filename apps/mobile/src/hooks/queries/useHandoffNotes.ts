/** @module hooks/queries/useHandoffNotes — handoff notes for one household day. */
import { useQuery } from '@tanstack/react-query';
import { handoffApi } from '@/src/api/endpoints/handoff';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useHandoffNotes(
  householdId: string | null | undefined,
  localDate: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.handoff.list(
      householdId ?? undefined,
      localDate ?? undefined
    ),
    queryFn: () => handoffApi.list(householdId as string, localDate as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled:
      !!session &&
      isInitialized &&
      isValidId(householdId) &&
      !!localDate &&
      localDate.length > 0,
  });
}
