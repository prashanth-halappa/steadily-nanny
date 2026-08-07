/**
 * @module hooks/mutations/useClockIn
 *
 * Optimistic clock-in writes a provisional running entry into the
 * `queryKeys.timeEntry.running()` cache via onMutate so the Today card
 * reflects "on the clock" immediately, including while offline (the
 * mutation pauses until reconnect and then retries). Residual limitation:
 * if the app process is killed before the paused mutation completes, the
 * queued clock-in is lost — there is no persistence layer (Wave 2I / G20).
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { QueryClient } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ClockInInput, TimeEntry } from '@/src/api/endpoints/timeEntries';
import { timeEntryApi } from '@/src/api/endpoints/timeEntries';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { startOnTheClock } from '@/src/lib/liveActivity';
import { useIsOnline } from '@/src/lib/network';
import { showErrorToast } from '@/src/lib/toast';
import {
  buildOptimisticRunningEntry,
  clockMutationRetry,
  getClockMutationErrorKey,
} from './timeEntryMutationUtils';

interface ApiErrorLike {
  response?: {
    data?: { error?: { code?: string; metadata?: { reason?: string } } };
  };
}

interface ClockInMutationContext {
  previous: TimeEntry | null | undefined;
}

// VERIFIED LIVE against the running API (2026-08-01): every ConflictError's
// top-level `error.code` is the generic "CONFLICT" (see
// apps/api/src/errors/ConflictError.ts — `code` is hardcoded, only `reason`
// varies per subclass). The specific identifier for a duplicate clock-in
// (`AlreadyClockedInError`, from the DB's `time_entries_one_running_per_carer`
// partial unique index) lives at `error.metadata.reason`, NOT `error.code`.
// Checking `code` alone would match every other 409 in this domain too
// (clocking out a finished entry, approving an unsubmitted week).
const ALREADY_CLOCKED_IN_REASON = 'ALREADY_CLOCKED_IN';

/**
 * "Only one running entry per carer" is enforced by a DB partial unique
 * index. Per the design brief this must be shown plainly, not folded into
 * the generic "conflict" copy, so it gets its own i18n key
 * (`errors:alreadyClockedIn`).
 */
function isAlreadyClockedInError(error: unknown): boolean {
  const err = (error ?? {}) as ApiErrorLike;
  return (
    err.response?.data?.error?.metadata?.reason === ALREADY_CLOCKED_IN_REASON
  );
}

function isShift(value: unknown, shiftId: string): value is Shift {
  const shift = value as Shift | null | undefined;
  return (
    !!shift &&
    shift.id === shiftId &&
    typeof shift.starts_at === 'string' &&
    typeof shift.ends_at === 'string'
  );
}

/**
 * The window the server just matched, out of whatever is already cached —
 * no request. The clock-in response carries only a `shift_id`, but by the
 * time anyone can press "Clock in" the shift itself is nearly always in
 * hand: `ClockInCard` holds today's range (`useShiftsRange`) and
 * `AppBootstrap` holds the carer's own upcoming shifts (`useMeShifts`),
 * which is why both prefixes are searched. A miss is not a failure — the
 * activity starts unmatched and `updateOnShiftMatch` fills it in — it just
 * costs a visible "No scheduled shift today." flash on the lock screen.
 */
function findCachedShift(
  queryClient: QueryClient,
  shiftId: string | null | undefined
): Shift | null {
  if (!shiftId) return null;
  for (const queryKey of [queryKeys.shift.all, queryKeys.me.all]) {
    for (const [, data] of queryClient.getQueriesData({ queryKey })) {
      const found = Array.isArray(data)
        ? (data as unknown[]).find(row => isShift(row, shiftId))
        : data;
      if (isShift(found, shiftId)) return found;
    }
  }
  return null;
}

/**
 * `householdTimezone` (the household's IANA zone — GOLDEN-FIXES #21) only
 * shapes the optimistic row; the server resolves the zone for the real one.
 *
 * `householdName` is for the Live Activity alone: the lock screen must name
 * the household, because a nanny working for several families and reading
 * "You're on the clock" with no name has a wrong-door problem.
 */
export function useClockIn(householdTimezone?: string, householdName?: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');
  const isOnline = useIsOnline();

  return useMutation<TimeEntry, Error, ClockInInput, ClockInMutationContext>({
    mutationFn: input => timeEntryApi.clockIn(input),
    networkMode: 'online',
    retry: clockMutationRetry,
    onMutate: async input => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.timeEntry.running(),
      });
      const previous = queryClient.getQueryData<TimeEntry | null>(
        queryKeys.timeEntry.running()
      );
      queryClient.setQueryData(
        queryKeys.timeEntry.running(),
        buildOptimisticRunningEntry(input, householdTimezone)
      );
      if (!isOnline) {
        showErrorToast(
          getLocalizedErrorMessage({ isAxiosError: true }, t, 'errors:offline')
        );
      }
      return { previous };
    },
    onSuccess: data => {
      queryClient.setQueryData(queryKeys.timeEntry.running(), data);
      queryClient.invalidateQueries({ queryKey: queryKeys.timeEntry.all });
      // Wired here rather than in the card so ANY future clock-in call site
      // gets the Live Activity for free. Deliberately not awaited: the
      // activity is decoration, and it swallows its own failures.
      void startOnTheClock(
        data,
        findCachedShift(queryClient, data.shift_id),
        householdName ?? ''
      );
    },
    onError: (error, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(
          queryKeys.timeEntry.running(),
          context.previous
        );
      }

      showErrorToast(
        getLocalizedErrorMessage(
          error,
          t,
          getClockMutationErrorKey(
            error,
            isOnline,
            isAlreadyClockedInError(error)
              ? 'errors:alreadyClockedIn'
              : undefined
          )
        )
      );

      // D7: a 409 ALREADY_CLOCKED_IN means the thing the caller wanted (being
      // on the clock) is already true server-side — e.g. the OTHER half of a
      // double-tap won the race, or another device clocked in first. The
      // server, not this failed request, is the source of truth, so refetch
      // rather than leaving the Today card frozen on stale pre-clock-in
      // cache. Without this, a losing double-tap request left the card
      // claiming "Clock in" while a running entry existed the whole time.
      if (isAlreadyClockedInError(error)) {
        queryClient.invalidateQueries({ queryKey: queryKeys.timeEntry.all });
      }
    },
  });
}
