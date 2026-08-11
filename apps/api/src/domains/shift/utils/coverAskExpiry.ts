/**
 * When an unanswered ask stops being answerable (S1 · D-22 + D-47).
 *
 * Pure and synchronous on purpose: the deadline is computed ONCE, at ask time,
 * and stored on `shifts.cover_ask_expires_at`. Nothing recomputes it later —
 * see `supabase/migrations/088_cover_ask_expiry.sql` for the full why, and
 * `docs/design/attention-and-notifications.md` §5.2 for the worked failure a
 * derived deadline produces (a 21:00 Thursday ask for a 07:00 Friday shift
 * still `pending` at 07:00, with `shift_no_show` as the first signal).
 *
 * @module domains/shift/utils/coverAskExpiry
 */

/**
 * The outer cap. D-22 called it "48h, configurable".
 *
 * ponytail: a code constant rather than a `households` column, following the
 * precedent `EXPIRY_DAYS` set in `scheduleHorizonJob.ts` — the owner can tune
 * it here without a migration, and per-household configuration is the upgrade
 * path if families ever disagree about it.
 */
export const COVER_ASK_EXPIRY_HOURS = 48;

/**
 * How much runway the parent keeps if she says nothing.
 *
 * Four hours is the smallest window in which a parent can realistically call a
 * second carer, a grandparent, or rearrange their own morning. This is the
 * number that makes the whole decision worth having: an expiry that lands
 * after the shift has started is an expiry that told nobody anything.
 */
export const COVER_ASK_LEAD_HOURS = 4;

/**
 * The floor, for the genuine same-morning scramble.
 *
 * Under ~5h of lead time, `starts − 4h` is at or before the moment the ask was
 * created, so the lead collapses to one hour rather than going negative. An
 * ask that expires before it is read is worse than one with a short fuse.
 */
export const COVER_ASK_MIN_FUSE_HOURS = 1;

const HOUR_MS = 60 * 60 * 1000;

/**
 * `min(created + 48h, starts − 4h)`, floored to a 1h fuse, never after the
 * shift starts.
 *
 * Both arguments are parsed to instants before any comparison — PostgREST
 * hands back `+00:00` and JS writes `.000Z` for the same moment, and `<`
 * between those two strings is lexicographic nonsense (GOLDEN-FIXES #25). The
 * return is always the `.000Z` form.
 *
 * The final clamp to `starts_at` is not defensive tidying: expiry never fires
 * after the shift has started, because a sweep that "expires" a window already
 * in the past is writing fiction. After that instant the shift's own status
 * carries what happened.
 */
export function computeCoverAskExpiry(
  createdAt: string | Date,
  startsAt: string | Date
): string {
  const created = new Date(createdAt).getTime();
  const starts = new Date(startsAt).getTime();

  const capped = created + COVER_ASK_EXPIRY_HOURS * HOUR_MS;
  const withLead = starts - COVER_ASK_LEAD_HOURS * HOUR_MS;

  let expires = Math.min(capped, withLead);

  if (expires < created + COVER_ASK_MIN_FUSE_HOURS * HOUR_MS) {
    // Same-morning scramble: fall back to an hour before the start, but never
    // give less than an hour to answer in.
    expires = Math.max(
      created + COVER_ASK_MIN_FUSE_HOURS * HOUR_MS,
      starts - COVER_ASK_MIN_FUSE_HOURS * HOUR_MS
    );
  }

  return new Date(Math.min(expires, starts)).toISOString();
}
