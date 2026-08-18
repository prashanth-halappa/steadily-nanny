/**
 * @module hooks/mutations/useRefreshDayThread
 *
 * Parent-only explicit uncovered-care recheck (S14) — see
 * `docs/12-NEED-COVERAGE.md` "S14 — the read backstop is gone (PR5)".
 * Deliberately silent: no success/error toast. The one caller
 * (`useWidgetSnapshotSync`) fires this best-effort in the background, so any
 * error handling belongs at that call site, not here.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { shiftApi } from '@/src/api/endpoints/shifts';
import { queryKeys } from '@/src/api/queryKeys';

export function useRefreshDayThread() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { householdId: string; localDate: string }>({
    mutationFn: ({ householdId, localDate }) =>
      shiftApi.refreshDayThread(householdId, localDate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
    },
  });
}
