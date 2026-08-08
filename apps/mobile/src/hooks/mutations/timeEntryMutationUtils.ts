/** @module hooks/mutations/timeEntryMutationUtils */

import {
  TIME_ENTRY_KINDS,
  TIME_ENTRY_STATUSES,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import * as Crypto from 'expo-crypto';
import type { ClockInInput, TimeEntry } from '@/src/api/endpoints/timeEntries';
import { localDateInZone } from '@/src/lib/localDate';

/** Client-only marker on optimistic cache rows — not part of the wire contract. */
export type OptimisticTimeEntry = TimeEntry & { isOptimistic?: true };

export function isOptimisticTimeEntry(
  entry: TimeEntry | OptimisticTimeEntry | null | undefined
): entry is OptimisticTimeEntry & { isOptimistic: true } {
  return (entry as OptimisticTimeEntry | undefined)?.isOptimistic === true;
}

interface ErrorLike {
  message?: string;
  name?: string;
  isAxiosError?: boolean;
  response?: {
    status?: number;
    data?: { error?: { code?: string; metadata?: { reason?: string } } };
  };
}

function asErrorLike(error: unknown): ErrorLike {
  return (error ?? {}) as ErrorLike;
}

function isOfflineError(error: ErrorLike): boolean {
  return error.isAxiosError === true && !error.response;
}

function isNetworkError(error: ErrorLike): boolean {
  const message = (error.message ?? '').toLowerCase();
  const name = (error.name ?? '').toLowerCase();
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('connection') ||
    name.includes('network') ||
    name === 'aborterror'
  );
}

function isTimeoutError(error: ErrorLike): boolean {
  const message = (error.message ?? '').toLowerCase();
  return message.includes('timeout') || message.includes('timed out');
}

/** Network/transport failures may succeed on retry; API 4xx/5xx must not loop. */
export function isRetryableClockMutationError(error: unknown): boolean {
  const err = asErrorLike(error);
  if (err.response?.status) return false;
  return isOfflineError(err) || isNetworkError(err) || isTimeoutError(err);
}

/** Per-mutation retry — overrides queryClient's queries-only default (retry: 0). */
export function clockMutationRetry(
  failureCount: number,
  error: unknown
): boolean {
  return isRetryableClockMutationError(error) && failureCount < 3;
}

/** Offline copy takes precedence over transport-shape detection in onError. */
export function getClockMutationErrorKey(
  _error: unknown,
  isOnline: boolean,
  contextKey?: string
): string | undefined {
  if (contextKey) return contextKey;
  if (!isOnline) return 'errors:offline';
  return undefined;
}

/**
 * Server wins on clock-out conflicts — e.g. optimistic clear while the entry
 * was already closed elsewhere, or clock-out against a fake optimistic id.
 */
export function isClockOutConflictError(error: unknown): boolean {
  const err = asErrorLike(error);
  const status = err.response?.status;
  if (status === 404) return true;
  if (status === 409) {
    const reason = err.response?.data?.error?.metadata?.reason;
    const code = err.response?.data?.error?.code;
    if (reason === 'TIME_ENTRY_NOT_RUNNING') return true;
    if (code === 'CONFLICT') return true;
  }
  const message = (err.message ?? '').toLowerCase();
  return message.includes('not running');
}

/**
 * The ways the server refuses a correction (Daylight UX P0-2), mapped to a
 * specific `errors` key each. The generic "that conflicts with the current
 * state" tells a carer nothing about a pay record she is trying to fix, and
 * each refusal needs a different response from her: an approved week is
 * someone else's to re-open, a bad time is hers to retype, a 16h span or a
 * week-crossing finish needs a different entry entirely — so the last two
 * get their own copy rather than folding into `invalidClockTimes`.
 */
export function getTimeEntryEditErrorKey(error: unknown): string | undefined {
  const err = asErrorLike(error);
  const reason = err.response?.data?.error?.metadata?.reason;
  const status = err.response?.status;
  if (reason === 'voided' && (status === 409 || status === 400)) {
    return 'errors:entryVoided';
  }
  if (err.response?.status === 409 && reason === 'TIME_ENTRY_NOT_EDITABLE') {
    return 'errors:entryNotEditable';
  }
  if (err.response?.status !== 400) return undefined;
  if (reason === 'CLOCK_SPAN_TOO_LONG') return 'errors:clockSpanTooLong';
  if (reason === 'CLOCK_OUT_CHANGES_WEEK') return 'errors:clockOutChangesWeek';
  if (
    reason === 'CLOCK_OUT_BEFORE_CLOCK_IN' ||
    reason === 'CLOCK_OUT_IN_FUTURE' ||
    reason === 'CLOCK_IN_CHANGES_WEEK' ||
    reason === 'MISSING_CLOCK_TIME'
  ) {
    return 'errors:invalidClockTimes';
  }
  return undefined;
}

/**
 * `householdTimezone` is the household's IANA zone (GOLDEN-FIXES #21) — with
 * the device's as a fallback for callers that have no household context. A
 * carer clocking in from another timezone would otherwise get an optimistic
 * row in the wrong day bucket, invisible in week views, until the server row
 * (which resolves the zone itself) replaces it.
 */
export function buildOptimisticRunningEntry(
  input: ClockInInput,
  householdTimezone?: string
): OptimisticTimeEntry {
  const now = new Date();
  const clockInAt = now.toISOString();
  const timezone =
    householdTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    id: Crypto.randomUUID(),
    household_id: input.household_id,
    carer_id: '00000000-0000-4000-8000-000000000000',
    // Placeholder, like carer_id above — the caller doesn't have (and
    // doesn't need) their own snapshotted name for this brief optimistic
    // window; onSuccess swaps this row for the real server response, which
    // carries the API's carer_display_name snapshot.
    carer_display_name: '',
    shift_id: input.shift_id ?? null,
    clock_in_at: clockInAt,
    clock_out_at: null,
    break_minutes: 0,
    scheduled_minutes: null,
    kind: TIME_ENTRY_KINDS.WORKED,
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: TIME_ENTRY_STATUSES.RUNNING,
    local_date: localDateInZone(timezone, now),
    timezone,
    created_at: clockInAt,
    updated_at: clockInAt,
    isOptimistic: true,
  };
}
