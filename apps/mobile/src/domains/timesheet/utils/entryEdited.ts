/**
 * @module domains/timesheet/utils/entryEdited
 *
 * Two derivations the Hours screen needs about a single entry: whether it
 * has been corrected since it was clocked out, and whether it can still be
 * corrected. Pure, so both read the same way in a test as on screen.
 *
 * Daylight UX P0-2.
 */
import type { TimeEntry, TimesheetStatus } from '../types';
import { endsAtLocalMidnight } from './splitFragment';

/**
 * A minute of slack separates "that's just the write that finished the row"
 * from "someone came back and changed this", without needing a column to
 * record it.
 *
 * Only reachable on the FALLBACK path below — rows written before migration
 * 113, and corrections that moved only the break or the note. Every row the
 * app observed answers exactly instead.
 */
const EDIT_DETECTION_SLACK_MS = 60_000;

/**
 * Was this entry changed after it was clocked out?
 *
 * Since migration 113 this is a comparison of two real values: what the app
 * WATCHED (`observed_clock_in_at` / `observed_clock_out_at`, frozen at the
 * tap) against what is EFFECTIVE now. It replaced an `updated_at` heuristic
 * that could say THAT the record moved and never what changed.
 *
 * One of that heuristic's exceptions survives and must: `endsAtLocalMidnight`.
 * A split session's boundary end is unobserved BY DESIGN, so that half still
 * falls through to the fallback and still needs guarding — see the comment
 * there. The exception is demoted, not deleted.
 *
 * A NULL OBSERVATION MEANS "NOT OBSERVED", NEVER "UNCHANGED", and the
 * `!== null` guards below are the whole reason this reads correctly. Four
 * shapes carry null and none of them is a correction: rows predating 113,
 * retroactive entries (a claim about the past, never watched), cancellation
 * pay (nobody tapped anything), and the boundary end of a session split at
 * midnight or a week edge. Drop the null checks and every overnight shift
 * renders as edited — which is exactly the bug the old `endsAtLocalMidnight`
 * exception existed to suppress.
 *
 * The `updated_at` fallback survives for the two cases the columns cannot
 * answer: a pre-113 row, and a correction that touched only the break or the
 * note, which leaves both clock times equal to their observations.
 */
export function wasEntryEdited(entry: TimeEntry): boolean {
  // Voiding bumps `updated_at` but is not a correction — never show "edited".
  if (entry.status === 'voided') return false;
  if (!entry.clock_out_at) return false;

  const observedIn = entry.observed_clock_in_at ?? null;
  const observedOut = entry.observed_clock_out_at ?? null;
  if (observedIn !== null && observedIn !== entry.clock_in_at) return true;
  if (observedOut !== null && observedOut !== entry.clock_out_at) return true;
  // FALLBACK, for the ends the app did not watch. Reached by a pre-113 row, a
  // break/note-only change, and — the case that matters — the half of a split
  // session that CLOSES at the boundary, whose `observed_clock_out_at` is
  // null by design.
  //
  // That last one is why `endsAtLocalMidnight` survives here rather than being
  // deleted with the rest of the heuristic's scaffolding: the split write
  // lands long after the clock-in, so `updated_at` alone brands every
  // overnight and week-crossing fragment as corrected. The observed columns
  // answer the ends they cover; this still guards the end they cannot.
  if (endsAtLocalMidnight(entry)) return false;
  const clockOutMs = new Date(entry.clock_out_at).getTime();
  const createdMs = new Date(entry.created_at).getTime();
  const updatedMs = new Date(entry.updated_at).getTime();
  if (!Number.isFinite(clockOutMs) || !Number.isFinite(updatedMs)) return false;
  // The row settles at whichever came LAST: an ordinary session is born at
  // clock-IN and finished by the clock-out write, while a retroactive entry
  // is born complete with its clock-out already in the past. Comparing
  // against clock-out alone brands every retro entry as edited from birth;
  // against created_at alone brands every ordinary session, whose two
  // timestamps are a whole shift apart by design.
  const settledMs = Number.isFinite(createdMs)
    ? Math.max(clockOutMs, createdMs)
    : clockOutMs;
  return updatedMs > settledMs + EDIT_DETECTION_SLACK_MS;
}

/**
 * Can the carer correct this entry FROM THE HOURS SCREEN? An approved week is
 * a signed agreement that only the parent's query flow re-opens.
 *
 * Deliberately still `submitted`-only, even though the server now also
 * accepts a correction to a RUNNING entry's start. That correction belongs to
 * Today, on the running clock card, where she is standing when she notices —
 * and the Hours sheet edits a completed span, which a running row does not
 * have. `TimeEntryRow` independently refuses to make a running row pressable,
 * so widening this would change nothing except what the name promises.
 *
 * The server is the authority; this exists so the row doesn't offer an edit
 * that would come back as a 409.
 */
export function isEntryEditable(
  entry: TimeEntry,
  timesheetStatus: TimesheetStatus | null | undefined
): boolean {
  return entry.status === 'submitted' && timesheetStatus !== 'approved';
}
