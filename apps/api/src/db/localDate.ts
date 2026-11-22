/**
 * The Postgres local-date triggers, as functions the service layer calls on
 * every write that sets or changes the source columns. D1 has no `AT TIME
 * ZONE`, so `local_date` (NOT NULL on both tables) must be supplied by the app.
 *
 * - `sync_shifts_local_date` (015): on insert, or update of `starts_at` /
 *   `timezone` -> `shiftLocalDate`.
 * - `sync_time_entries_local_date` (017): on insert, or update of
 *   `clock_in_at` / `clock_out_at` / `timezone` -> `timeEntryLocalDate`.
 *
 * Both reuse the codebase's one Intl-based `localDateOf`.
 *
 * @module db/localDate
 */
import { localDateOf } from '../domains/timesheet/utils/weekStart';

type Instant = string | Date;
const toDate = (i: Instant) => (typeof i === 'string' ? new Date(i) : i);

/** `(starts_at at time zone timezone)::date` */
export function shiftLocalDate(startsAt: Instant, timeZone: string): string {
  return localDateOf(toDate(startsAt), timeZone);
}

/** `(coalesce(clock_in_at, clock_out_at, now()) at time zone timezone)::date` */
export function timeEntryLocalDate(
  entry: { clock_in_at?: Instant | null; clock_out_at?: Instant | null },
  timeZone: string,
  now: Date = new Date()
): string {
  return localDateOf(
    toDate(entry.clock_in_at ?? entry.clock_out_at ?? now),
    timeZone
  );
}
