/**
 * @module domains/today/utils/timeEntryOverlapError
 *
 * Shared across every write that can overlap an existing entry (clock-out,
 * retroactive add, correction) — not today-only, despite living here.
 *
 * Those writes 409 with `TIME_ENTRY_OVERLAPS` when the resolved span
 * intersects another entry. A bare "conflict" toast leaves the carer with no
 * idea which entry to fix. Pull the conflicting entry's day/range off the
 * envelope and build the actionable copy — same showErrorToast path as every
 * other mutation refusal, just with a human identifier. The conflicting entry
 * may still be RUNNING (she forgot to clock out and is now typing the same
 * hours in by hand), which has no range and its own copy.
 */

const TIME_ENTRY_OVERLAPS_REASON = 'TIME_ENTRY_OVERLAPS';

interface OverlapErrorLike {
  response?: {
    status?: number;
    data?: {
      error?: {
        metadata?: {
          reason?: unknown;
          overlappingEntryId?: unknown;
          overlappingClockInAt?: unknown;
          overlappingClockOutAt?: unknown;
        };
      };
    };
  };
}

export interface OverlappingEntry {
  id: string;
  clockInAt: string;
  /** null when the conflicting entry is still running (no finish yet). */
  clockOutAt: string | null;
}

/**
 * The conflicting entry (id + times), or null when this isn't an overlap 409
 * / the API omitted the id or start (older build — degrade gracefully). A
 * missing finish is not a degraded envelope: that entry is still running.
 */
export function getOverlappingEntry(error: unknown): OverlappingEntry | null {
  const err = (error ?? {}) as OverlapErrorLike;
  if (err.response?.status !== 409) return null;
  const meta = err.response.data?.error?.metadata;
  if (meta?.reason !== TIME_ENTRY_OVERLAPS_REASON) return null;
  const id = meta.overlappingEntryId;
  const clockInAt = meta.overlappingClockInAt;
  const clockOutAt = meta.overlappingClockOutAt;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof clockInAt !== 'string' || clockInAt.length === 0) return null;
  return {
    id,
    clockInAt,
    clockOutAt:
      typeof clockOutAt === 'string' && clockOutAt.length > 0
        ? clockOutAt
        : null,
  };
}

/**
 * Localized overlap refusal. `getLocalizedErrorMessage`'s contextKey path
 * cannot interpolate, so callers use this with the `errors` t-function and
 * pass `day` / `range` into the template. A null `range` means the
 * conflicting entry is still running — different copy, since the fix is to
 * clock out of it rather than to shorten it. Under the key-echo test mock
 * (which ignores options), day+range are appended so behaviour tests still
 * identify the conflicting entry — never a raw UUID.
 */
export function formatTimeEntryOverlapMessage(
  t: (key: string, options?: { day: string; range?: string }) => string,
  day: string,
  range: string | null
): string {
  if (range === null) {
    const localized = t('timeEntryOverlapsRunning', { day });
    return localized.includes(day) ? localized : `${localized} ${day}`;
  }
  const localized = t('timeEntryOverlaps', { day, range });
  if (localized.includes(day) && localized.includes(range)) {
    return localized;
  }
  return `${localized} ${day} (${range})`;
}
