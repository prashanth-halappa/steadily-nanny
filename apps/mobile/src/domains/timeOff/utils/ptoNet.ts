/**
 * @module domains/timeOff/utils/ptoNet
 *
 * Phase 3+4 adversarial review, finding 2: `pto_ledger` is append-only
 * (docs/11-MONEY.md §5) — when a carer cancels time off a household already
 * marked paid, the server never deletes or edits the `usage` row; it
 * inserts a REVERSING `adjustment` row carrying the SAME `time_off_id`
 * (`apps/api/src/domains/pay/services/ptoCommandService.ts`'s
 * `reconcileCancelledTimeOff`). Any surface that decides "is this time off
 * paid" from the mere PRESENCE of a `usage` row therefore keeps reading
 * "paid" forever, even after a full reversal — the ledger row never goes
 * away, only its net effect does.
 *
 * `netPaidMinutesForTimeOff` is the one place that netting happens: sum
 * every `usage`/`adjustment` row tagged with this `time_off_id` (an
 * `accrual` row never carries one, so it's excluded by construction) and
 * report how much is STILL paid, in minutes. `usage` rows are always
 * negative and a reversing `adjustment` is the positive mirror, so:
 *   - never marked paid (no matching rows) -> net is 0 -> not paid.
 *   - marked paid, never reversed -> net is negative -> paid at the full
 *     amount.
 *   - fully reversed (adjustment exactly mirrors usage) -> net is 0 -> not
 *     paid.
 *   - PARTIALLY reversed (a smaller adjustment) -> net stays negative ->
 *     still paid, at the remainder.
 * The return value is always >= 0 (0 when not paid), so callers never have
 * to re-derive the sign themselves.
 */

/** The subset of `PtoLedgerEntry` this function actually reads — kept
 * narrow (not the full shared type) so callers can pass whatever shape
 * their own query returns, including test fixtures that only set these
 * three fields. */
export interface PtoNetLedgerEntry {
  kind: string;
  time_off_id: string | null;
  minutes: number;
}

export function netPaidMinutesForTimeOff(
  entries: readonly PtoNetLedgerEntry[],
  timeOffId: string
): number {
  const net = entries
    .filter(
      entry =>
        entry.time_off_id === timeOffId &&
        (entry.kind === 'usage' || entry.kind === 'adjustment')
    )
    .reduce((sum, entry) => sum + entry.minutes, 0);

  // A negative net means the household still owes (has paid) that many
  // minutes; zero or positive means nothing is currently paid — a
  // reconciling adjustment can only ever bring the net back up to zero or
  // partway there, never past it into a positive "owed the other way"
  // balance (the server writes the exact mirror, never an over-reversal).
  return net < 0 ? -net : 0;
}
