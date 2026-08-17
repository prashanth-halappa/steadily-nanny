/**
 * Recognising migration 104's `shifts_carer_window_excl` (audit S4a).
 *
 * The constraint refuses two overlapping LIVE windows for one carer inside
 * one household and raises `23P01`. Three repositories have to translate that
 * into `ShiftOverlapsError` — the shift domain's `shiftRepository` and
 * `shiftChangeRequestRepository`, and the schedule domain's
 * `scheduleShiftRepository` — so the predicate lives here rather than as a
 * third copy of the same six lines.
 *
 * MATCHED ON THE CONSTRAINT NAME, never the bare code, for the same reason
 * `isExtraWindowCollision` and `isRecurringWindowCollision` are: `shifts`
 * already carries other constraints and will grow more, and mistranslating
 * one of those would tell a parent about a double-booking that is not there.
 *
 * @module domains/shift/utils/carerWindowOverlap
 */

/** Postgres `exclusion_violation`. */
const EXCLUSION_VIOLATION = '23P01';

/** Migration 104's exclusion constraint — the name the 23P01 is matched on. */
export const CARER_WINDOW_EXCLUSION = 'shifts_carer_window_excl';

export function isCarerWindowOverlap(error: {
  code?: string;
  message: string;
  details?: string | null;
}): boolean {
  return (
    error.code === EXCLUSION_VIOLATION &&
    `${error.message} ${error.details ?? ''}`.includes(CARER_WINDOW_EXCLUSION)
  );
}
