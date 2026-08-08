/**
 * @module domains/today/utils/attentionOwner
 *
 * "One T1 per screen" — the single ranked decision `TodayScreen` uses to
 * arbitrate between its independent `tone="attention"` triggers. Extending
 * the ladder means adding a rung HERE, never a fourth ad-hoc boolean on a
 * fourth card (this is the third collision of that shape: inbox+pattern,
 * inbox+overdue, inbox+coverage-gap).
 *
 * Ranked by urgency, not render order:
 *   1. `overdue`      — an overdue clock-out corrupts the pay record while
 *                        unresolved; it's also the one obligation that is
 *                        nanny-actionable in a single tap.
 *   2. `coverageGap`   — a child may be uncovered RIGHT NOW; immediate and
 *                        consequential, but nobody's pay is silently wrong.
 *   3. `inbox`         — real obligations (approvals, queries), but they
 *                        wait safely — nothing decays by staying pending an
 *                        extra hour.
 *
 * `PendingScheduleCard` is NOT part of this ladder — it's T3 by design (a
 * pending pattern is already represented in the inbox, and `NeedsAttentionCard`
 * suppresses `pending_pattern` there so the two never say the same thing).
 */
export type AttentionOwner = 'overdue' | 'coverageGap' | 'inbox' | null;

export function resolveAttentionOwner(inputs: {
  overdue: boolean;
  hasCoverageGap: boolean;
  hasInboxItems: boolean;
}): AttentionOwner {
  if (inputs.overdue) return 'overdue';
  if (inputs.hasCoverageGap) return 'coverageGap';
  if (inputs.hasInboxItems) return 'inbox';
  return null;
}
