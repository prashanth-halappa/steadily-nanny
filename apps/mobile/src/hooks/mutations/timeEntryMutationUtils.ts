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
    data?: {
      error?: {
        code?: string;
        // `reason` is the error CODE; `editableReason` is which of the four
        // not-editable refusals it actually was. See `getTimeEntryEditErrorKey`.
        metadata?: { reason?: string; editableReason?: string };
      };
    };
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
  // The SUB-reason, and the whole bug this function used to have. A
  // `TimeEntryNotEditableError` always sets `metadata.reason` to the literal
  // 'TIME_ENTRY_NOT_EDITABLE' (`ConflictError` fills it from the error CODE);
  // which of the four refusals it actually was lives one key over, in
  // `metadata.editableReason` (`timesheetErrors.ts`). Reading only `reason`
  // collapsed all four into one sentence that named approval — false for
  // three of them — and left the `voided` branch below permanently dead,
  // because 'voided' never arrives as `reason`.
  const editableReason = err.response?.data?.error?.metadata?.editableReason;
  const status = err.response?.status;
  if (editableReason === 'voided' && (status === 409 || status === 400)) {
    return 'errors:entryVoided';
  }
  if (status === 409 && reason === 'TIME_ENTRY_NOT_EDITABLE') {
    // An approved week is the parent's to reopen; cancellation pay is fixed by
    // fixing the shift. Both need a different action from her, so neither can
    // share the other's sentence.
    if (editableReason === 'week_approved') {
      return 'errors:entryNotEditableApproved';
    }
    if (editableReason === 'cancellation_paid') {
      return 'errors:entryNotEditableCancelled';
    }
    // 'running' deliberately has no sentence of its own. Since the server
    // began accepting a start correction on a live entry, it fires only if a
    // client sends a finish or a break on one — a client bug, not a state a
    // carer can reach, and better in Sentry than softened on screen.
    return 'errors:entryNotEditable';
  }
  // A1/A9. The terms gate is a policy on time RECORDS, not a button state —
  // `createRetroactiveEntry` and `updateEntry` carry the same guard as
  // `clockIn`, so every correction sheet can meet this 409 too. It gets the
  // blocked card's own sentence, never a code and never "forbidden".
  if (err.response?.status === 409 && reason === 'TERMS_NOT_AGREED') {
    return 'errors:termsNotAgreed';
  }
  if (err.response?.status !== 400) return undefined;
  if (reason === 'CLOCK_SPAN_TOO_LONG') return 'errors:clockSpanTooLong';
  if (reason === 'CLOCK_OUT_CHANGES_WEEK') return 'errors:clockOutChangesWeek';
  // The three week-boundary refusals state one rule three ways, and each
  // names the end that actually crossed. They used to land on the generic
  // times sentence ("the finish must be after the start"), which describes a
  // different problem and invites her to retype a field that is not wrong.
  if (reason === 'CLOCK_IN_CHANGES_WEEK') return 'errors:clockInChangesWeek';
  if (reason === 'CLOCK_CROSSES_WEEK') return 'errors:clockCrossesWeek';
  // A row with no start is a data anomaly, not something she typed — so this
  // must not tell her to fix her times.
  if (reason === 'MISSING_CLOCK_TIME') return 'errors:missingClockTime';
  if (
    reason === 'CLOCK_OUT_BEFORE_CLOCK_IN' ||
    reason === 'CLOCK_OUT_IN_FUTURE' ||
    reason === 'CLOCK_IN_IN_FUTURE'
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
