/**
 * @module hooks/queries/useShiftsRanges
 *
 * `useShiftsRange` for a variable number of `[from, to)` ranges — the
 * continuous Agenda's week pages. Same query per range (same key, same
 * gating), so a week is one cache entry whichever hook fetched it.
 */
import { useQueries } from '@tanstack/react-query';
import { useCanWriteHousehold } from '@/src/hooks/queries/useCanWriteHousehold';
import { shiftsRangeQuery } from '@/src/hooks/queries/useShiftsRange';
import { useAuthStore } from '@/src/store/auth';

export function useShiftsRanges(
  householdId: string | null | undefined,
  ranges: readonly { from: string; to: string }[]
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);
  const { canWrite } = useCanWriteHousehold(householdId);
  const enabled = !!session && isInitialized && canWrite;

  return useQueries({
    queries: ranges.map(range =>
      shiftsRangeQuery(householdId, range.from, range.to, enabled)
    ),
  });
}
