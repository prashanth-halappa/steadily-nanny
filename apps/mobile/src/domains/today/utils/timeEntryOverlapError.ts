/**
 * @module domains/today/utils/timeEntryOverlapError
 *
 * Clock-out can 409 with `TIME_ENTRY_OVERLAPS` when the resolved finish
 * intersects another completed entry. The running entry stays running, so a
 * bare "conflict" toast strands the carer mid-shift with no idea which entry
 * to fix. Pull the conflicting entry's day/range off the envelope and build
 * the actionable `errors:timeEntryOverlaps` copy — same showErrorToast path
 * as every other mutation refusal, just with a human identifier.
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
  clockOutAt: string;
}

/**
 * The conflicting completed entry (id + times), or null when this isn't an
 * overlap 409 / the API omitted times (older build — degrade gracefully).
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
  if (typeof clockOutAt !== 'string' || clockOutAt.length === 0) return null;
  return { id, clockInAt, clockOutAt };
}

/**
 * Localized overlap refusal. `getLocalizedErrorMessage`'s contextKey path
 * cannot interpolate, so callers use this with the `errors` t-function and
 * pass `day` / `range` into the template. Under the key-echo test mock
 * (which ignores options), day+range are appended so behaviour tests still
 * identify the conflicting entry — never a raw UUID.
 */
export function formatTimeEntryOverlapMessage(
  t: (key: string, options?: { day: string; range: string }) => string,
  day: string,
  range: string
): string {
  const localized = t('timeEntryOverlaps', { day, range });
  if (localized.includes(day) && localized.includes(range)) {
    return localized;
  }
  return `${localized} ${day} (${range})`;
}
