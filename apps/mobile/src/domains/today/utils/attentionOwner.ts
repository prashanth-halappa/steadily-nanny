/**
 * @module domains/today/utils/attentionOwner
 *
 * "One T1 per screen" — the single ranked decision `TodayScreen` uses to
 * arbitrate between its independent attention triggers. It is now the
 * SELECTOR for the pinned slot (`resolveSlotOccupant`), not a styling hint:
 * the slot physically holds one item, so the ladder answers "which one".
 *
 * Ranked by urgency, not render order:
 *   1. `termsBlocked`  — the clock-in block sits above `overdue`, because an
 *                        overdue clock-out corrupts a record that exists,
 *                        while the block prevents the record existing at all.
 *   2. `sentOfferBlocking` — A7's parent-side half of the same block: HE
 *                        wrote the terms, so only he can unblock them, and
 *                        she has a shift today that cannot be recorded. It
 *                        DISPLACES `overdue`, for the same reason rung 1
 *                        does — an overdue clock-out is one record to fix
 *                        after the fact, this is every record prevented.
 *                        Consequence is the ONLY thing that puts it here:
 *                        a stale offer with no shift on the books never
 *                        enters the ladder at all, however old it gets.
 *   3. `overdue`       — an overdue clock-out corrupts the pay record while
 *                        unresolved; it's also the one obligation that is
 *                        nanny-actionable in a single tap.
 *   4. `uncoveredCare` — a child may be uncovered RIGHT NOW; immediate and
 *                        consequential, but nobody's pay is silently wrong.
 *   5. `termsProposal` — terms awaiting an answer (§7.1). Below uncovered
 *                        care because a child with nobody booked outranks a
 *                        contract; above the inbox because until it is
 *                        answered there is no agreed rate, so every future
 *                        figure this app shows is blocked behind it.
 *   6. `inbox`         — real obligations (approvals, queries), but they
 *                        wait safely — nothing decays by staying pending an
 *                        extra hour.
 *
 * RULE FOR THE NEXT RUNG: adding one requires naming which rung it
 * displaces, here in this doc and in the test file. One slot, one occupant —
 * a rung that displaces nothing is not a rung, it belongs in the feed.
 *
 * `PendingScheduleCard` is NOT part of this ladder — it's T3 by design (a
 * pending pattern is already represented in the inbox, and `NeedsAttentionCard`
 * suppresses `pending_pattern` there so the two never say the same thing).
 */
export type AttentionOwner =
  | 'termsBlocked'
  | 'sentOfferBlocking'
  | 'overdue'
  | 'uncoveredCare'
  | 'termsProposal'
  | 'inbox'
  | null;

export function resolveAttentionOwner(inputs: {
  /** A1's hard block: she cannot clock in until terms are agreed. Optional
   * so callers that predate the rung keep compiling — an omitted flag is
   * "not blocked". */
  termsBlocked?: boolean;
  /** A7's consequence axis: a proposal THIS viewer authored is unanswered
   * and the carer it names has a shift today. Optional, so an omitted flag
   * is "no blocking offer" rather than a silently-owned slot. */
  hasBlockingSentOffer?: boolean;
  overdue: boolean;
  hasUncoveredCare: boolean;
  /** §7.1's L1 case: a `proposed` proposal for a carer with no live
   * arrangement. Optional so callers that predate the rung keep compiling —
   * an omitted flag is "no proposal", never a silently-owned T1 slot. */
  hasTermsProposal?: boolean;
  hasInboxItems: boolean;
}): AttentionOwner {
  if (inputs.termsBlocked) return 'termsBlocked';
  if (inputs.hasBlockingSentOffer) return 'sentOfferBlocking';
  if (inputs.overdue) return 'overdue';
  if (inputs.hasUncoveredCare) return 'uncoveredCare';
  if (inputs.hasTermsProposal) return 'termsProposal';
  if (inputs.hasInboxItems) return 'inbox';
  return null;
}
