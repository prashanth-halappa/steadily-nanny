/**
 * @module domains/schedule/utils/coverAskDeadline
 *
 * The ONE threshold for "is a cover-ask's `cover_ask_expires_at` close enough
 * to render in red" — shared by `inboxItemCopy.ts` (`deadlineForItem`'s
 * pending_shift branch, Today/inbox) and `ShiftDetailScreen` (M21's deadline
 * sentence). `docs/design/attention-and-notifications.md` M21: "same rule,
 * same threshold, both surfaces" — a deadline that goes red on one screen and
 * stays muted on the other, for the same shift, is the two-deadlines problem
 * the spec calls out by name.
 *
 * 12h, not the 24h §2.3a's prose separately mentions: §5.3/M21 pins the
 * shift-detail threshold at 12h and requires both surfaces to match, so this
 * constant resolves that inconsistency in favour of the sentence written
 * twice. One constant, so a future correction only has one place to make it.
 */
export const COVER_ASK_URGENT_HOURS = 12;

/** Whole-number urgency check: is `expiresAt` still ahead of `nowMs` but inside the urgent window? */
export function isCoverAskUrgent(
  expiresAt: string | null | undefined,
  nowMs: number
): boolean {
  if (!expiresAt) return false;
  const msUntil = Date.parse(expiresAt) - nowMs;
  if (!Number.isFinite(msUntil) || msUntil < 0) return false;
  return msUntil <= COVER_ASK_URGENT_HOURS * 60 * 60 * 1000;
}
