/**
 * @module hooks/queries/useShiftsRange
 *
 * Materialised shifts for a household within a `[from, to)` range. `from`/
 * `to` MUST be full ISO datetime strings with an offset (never a plain
 * "YYYY-MM-DD" — `GET /v1/households/:householdId/shifts` 400s on that, see
 * `apps/api/src/domains/shift/schemas.ts`'s `ShiftRangeQuerySchema`).
 * `isShiftsRouteUnavailable(query.error)` stays exported as a defensive
 * check — screens should use it to render an honest "not available yet"
 * state instead of a generic error if the route is ever missing in a given
 * environment — and this hook does not retry a 404 (it won't resolve itself).
 */
import { useQuery } from '@tanstack/react-query';
import { shiftApi } from '@/src/api/endpoints/shifts';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

interface AxiosLikeError {
  response?: { status?: number };
}

/** True when the failure is the shift-range route not existing yet (404). */
export function isShiftsRouteUnavailable(error: unknown): boolean {
  return (error as AxiosLikeError)?.response?.status === 404;
}

export function useShiftsRange(
  householdId: string | null | undefined,
  from: string,
  to: string
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.shift.range(householdId ?? undefined, from, to),
    queryFn: () => shiftApi.range(householdId as string, from, to),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled: !!session && isInitialized && isValidId(householdId),
    retry: (failureCount, error) =>
      !isShiftsRouteUnavailable(error) && failureCount < 2,
  });
}
