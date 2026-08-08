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
 * The one exception is the first fragment of a session the server split at
 * local midnight — see `endsAtLocalMidnight`, which `wasEntryEdited` skips.
 */
const EDIT_DETECTION_SLACK_MS = 60_000;

/**
 * Was this entry changed after it was clocked out?
 *
 * ponytail: derived from `updated_at`, so it can say THAT the record moved,
 * never what changed or who changed it. That is honest for a first pass —
 * the alternative is a `time_entry_edits` table, which is worth building the
 * first time a parent actually disputes a correction, and not before.
 */
export function wasEntryEdited(entry: TimeEntry): boolean {
  // Voiding bumps `updated_at` but is not a correction — never show "edited".
  if (entry.status === 'voided') return false;
  if (!entry.clock_out_at) return false;
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
 * Can the carer still correct this entry? Mirrors the server's gate in
 * `timesheetCommandService.updateEntry` — a running entry is corrected by
 * clocking out, and an approved week is a signed agreement that only the
 * parent's query flow re-opens.
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
