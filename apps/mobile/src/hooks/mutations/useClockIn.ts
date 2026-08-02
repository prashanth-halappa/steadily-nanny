/** @module hooks/mutations/useClockIn */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ClockInInput, TimeEntry } from '@/src/api/endpoints/timeEntries';
import { timeEntryApi } from '@/src/api/endpoints/timeEntries';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

interface ApiErrorLike {
  response?: {
    data?: { error?: { code?: string; metadata?: { reason?: string } } };
  };
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

export function useClockIn() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<TimeEntry, Error, ClockInInput>({
    mutationFn: input => timeEntryApi.clockIn(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.timeEntry.all });
    },
    onError: error => {
      showErrorToast(
        getLocalizedErrorMessage(
          error,
          t,
          isAlreadyClockedInError(error) ? 'errors:alreadyClockedIn' : undefined
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
