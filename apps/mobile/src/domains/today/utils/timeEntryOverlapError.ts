/**
 * @module domains/today/utils/timeEntryOverlapError
 *
 * Clock-out can now 409 with `TIME_ENTRY_OVERLAPS` when the resolved finish
 * intersects another completed entry. The running entry stays running, so a
 * bare "conflict" toast strands the carer mid-shift with no idea which entry
 * to fix. Pull `overlappingEntryId` off the envelope and build the actionable
 * `errors:timeEntryOverlaps` copy — same showErrorToast path as every other
 * mutation refusal, just with the id named.
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
        };
      };
    };
  };
}

/** The conflicting completed entry id, or null when this isn't an overlap 409. */
export function getOverlappingEntryId(error: unknown): string | null {
  const err = (error ?? {}) as OverlapErrorLike;
  if (err.response?.status !== 409) return null;
  const meta = err.response.data?.error?.metadata;
  if (meta?.reason !== TIME_ENTRY_OVERLAPS_REASON) return null;
  const id = meta.overlappingEntryId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Localized overlap refusal. `getLocalizedErrorMessage`'s contextKey path
 * cannot interpolate, so callers use this with the `errors` t-function and
 * pass `entryId` into the template. Under the key-echo test mock (which
 * ignores options), the id is appended so the toast still identifies the
 * conflicting entry in behaviour tests.
 */
export function formatTimeEntryOverlapMessage(
  t: (key: string, options?: { entryId: string }) => string,
  entryId: string
): string {
  const localized = t('timeEntryOverlaps', { entryId });
  return localized.includes(entryId) ? localized : `${localized} ${entryId}`;
}
