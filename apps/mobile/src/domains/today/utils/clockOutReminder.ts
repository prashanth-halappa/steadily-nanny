/**
 * @module domains/today/utils/clockOutReminder
 *
 * When a running clock-in stops being plausible, and what finish time to
 * offer when it does. Pure — no React, no notifications API, no `Date.now()`
 * read internally — so both the reminder scheduler and the on-screen card
 * state derive from ONE rule and can be tested without faking timers.
 *
 * Daylight UX #7. Nothing used to handle a forgotten clock-out: the timer
 * would read `37h 12m` the next morning and the server would faithfully
 * record it. The person who eats a wrong paycheck is the one who can least
 * afford to argue about it.
 */

/**
 * Grace after a scheduled finish before the app says anything. Long enough
 * that an ordinary overrun — settling a child, a parent home late — passes
 * in silence, short enough that a genuinely forgotten clock-out is caught
 * the same evening rather than the next morning.
 */
export const SCHEDULED_FINISH_GRACE_MS = 30 * 60 * 1000;

/**
 * Backstop for an entry with no matched shift (an ad-hoc clock-in, or one
 * the 2h auto-match window didn't catch). Nothing schedule-shaped is known,
 * so this is a bound on "no single session runs this long", not a guess at
 * the real finish.
 *
 * ponytail: one flat number for every household. If live-in or split-shift
 * arrangements ever make 10h wrong, derive it from the household's own
 * typical scheduled span rather than adding a setting nobody will find.
 */
export const MAX_UNSCHEDULED_SHIFT_MS = 10 * 60 * 60 * 1000;

/**
 * The instant (epoch ms) at which this running entry becomes suspect —
 * the scheduled finish plus grace when a shift was matched at clock-in,
 * otherwise the flat backstop.
 *
 * A shift whose finish is at or before the clock-in is ignored: that pairing
 * means the auto-match attached a shift that had already ended (a carer
 * clocking in an hour after a short shift's finish is inside the 2h window),
 * and treating it as the finish would mark the entry overdue on the spot.
 */
export function resolveOverdueAtMs(
  clockInAt: string,
  shiftEndsAt: string | null
): number {
  const clockInMs = new Date(clockInAt).getTime();
  const backstopMs = clockInMs + MAX_UNSCHEDULED_SHIFT_MS;
  if (!shiftEndsAt) return backstopMs;

  const shiftEndMs = new Date(shiftEndsAt).getTime();
  if (!Number.isFinite(shiftEndMs) || shiftEndMs <= clockInMs) {
    return backstopMs;
  }
  // Still bounded by the backstop: a mis-matched 20-hour shift must not
  // push the reminder past the point where the figure is obviously wrong.
  return Math.min(shiftEndMs + SCHEDULED_FINISH_GRACE_MS, backstopMs);
}

/** Has this running entry passed the point where it should be questioned? */
export function isOverdue(
  clockInAt: string,
  shiftEndsAt: string | null,
  nowMs: number
): boolean {
  return nowMs >= resolveOverdueAtMs(clockInAt, shiftEndsAt);
}

/**
 * The finish to PRE-FILL in the clock-out sheet, as an ISO instant.
 *
 * Normally "now": the domain records what happened, not what was planned,
 * and a carer who stayed 40 minutes late must not have that quietly
 * rewritten to her scheduled finish.
 *
 * Once overdue, "now" is the one answer that is certainly wrong — she left
 * hours ago. The scheduled finish is then the best available guess, offered
 * as an editable default rather than written silently. With no shift to
 * guess from there is nothing better than "now", so the sheet keeps it and
 * asks her to check it.
 */
export function resolveDefaultClockOutAt(
  clockInAt: string,
  shiftEndsAt: string | null,
  nowMs: number
): string {
  if (!isOverdue(clockInAt, shiftEndsAt, nowMs) || !shiftEndsAt) {
    return new Date(nowMs).toISOString();
  }
  const shiftEndMs = new Date(shiftEndsAt).getTime();
  const clockInMs = new Date(clockInAt).getTime();
  if (!Number.isFinite(shiftEndMs) || shiftEndMs <= clockInMs) {
    return new Date(nowMs).toISOString();
  }
  return new Date(shiftEndMs).toISOString();
}
