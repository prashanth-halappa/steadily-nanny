/**
 * @module domains/timesheet/utils/splitFragment
 *
 * A session that runs across the household-local week boundary (midnight on
 * the household's own first day of the week) is stored by the API as TWO
 * entries: the first keeps the original row's id with its `clock_out_at`
 * rewritten back to that boundary, the second carries the rest into the new
 * week. Nothing on the wire says "I am half a session", so the
 * only thing that distinguishes the first fragment from an ordinary entry is
 * where it ends.
 */
import { utcIsoToWallClockHHMM } from '@/src/lib/wallClock';
import type { TimeEntry } from '../types';

/**
 * Does this entry finish exactly at midnight in its OWN frozen zone?
 *
 * Two "something looks wrong here" signals on the Hours screen have to skip
 * such a row, because both of their assumptions break on it: its
 * `updated_at` is legitimately hours later than its rewritten `clock_out_at`
 * (`wasEntryEdited`), and its span rounds to zero when the carer clocked in
 * seconds before midnight (the zero-duration flag). Neither is a fault, and
 * a warning nobody can act on teaches people to ignore the ones that matter.
 *
 * The entry's own `timezone` column, never the household's current one —
 * same reason the server anchors on it: it is the zone `local_date` was
 * derived from, and a household that has since changed zones must not move
 * where an already-written row sits.
 *
 * ponytail: fails OPEN in a zone that springs forward at the week boundary — that
 * local midnight does not exist, so the split instant reads as 01:00 and both
 * signals come back on a legitimate fragment. No zone in tzdata does this
 * through 2029 (Tehran and Casablanca have historically), and the failure is
 * a spurious badge rather than a wrong figure. If one ever appears, match the
 * split instant itself instead of the wall clock.
 *
 * ponytail: minute resolution, so a genuine correction that happens to set
 * clock-out to exactly local midnight loses both signals. Both misses are
 * benign (a badge and a warning, never a figure), and the alternative is a
 * wire flag the API does not carry — add one if a split ever needs to be
 * distinguished from a deliberate midnight finish.
 */
export function endsAtLocalMidnight(entry: TimeEntry): boolean {
  return (
    !!entry.clock_out_at &&
    utcIsoToWallClockHHMM(entry.clock_out_at, entry.timezone) === '00:00'
  );
}
