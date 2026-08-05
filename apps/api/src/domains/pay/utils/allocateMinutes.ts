/**
 * Exact integer allocation of a minute total across parts — the ONE place
 * minutes are divided in this domain.
 *
 * Three callers, one rule: spreading a multi-day PTO marking across the days
 * it covers, re-spreading the same total after a correction
 * (`ptoCommandService`), and attributing a netted total back across dates for
 * pricing (`weekEarningsService.netPtoUsage`). Money is integer minor units
 * for the reason `docs/11-MONEY.md` §1 gives, and minutes are the same kind
 * of quantity: divide them with floats and a fortnight's 4801 minutes comes
 * back as 4800.999999.
 *
 * THE INVARIANT: `sum(allocateMinutes(total, weights)) === total`, exactly,
 * for every input. Not "approximately", not "up to rounding" — a lost minute
 * is a lost penny at the carer's rate and an invented one is money nobody
 * agreed to. Largest-remainder (Hamilton) apportionment gets there: floor
 * every share, then hand the leftover units out one each, in descending
 * remainder order with earlier parts winning ties, so the result is
 * deterministic and the extra minute lands on the earliest day rather than
 * wherever a sort happened to put it.
 *
 * @module domains/pay/utils/allocateMinutes
 */

/**
 * Split `total` minutes across `weights.length` parts in proportion to
 * `weights`.
 *
 * - `weights` all equal (the usual case, `[1, 1, 1]`) is an even split.
 * - A zero weight gets zero, so a day already reversed to nothing stays at
 *   nothing when a new total is allocated over the same days.
 * - A negative weight is treated as zero rather than subtracting from its
 *   neighbours: negative rows are already netted out before this is called,
 *   and letting one steal minutes from another day would silently move money
 *   between weeks.
 * - ALL weights zero (or empty of signal) falls back to an EVEN split: a
 *   fully-reversed marking has no per-day shape left to preserve, but a new
 *   total still has to land somewhere, and refusing to allocate would drop
 *   the parent's instruction on the floor.
 * - `total` of zero allocates zero to every part; the caller decides that a
 *   zero part means "write no row" (`pto_ledger` carries
 *   `check (minutes <> 0)`).
 *
 * `total` is expected non-negative — callers work in positive
 * "minutes paid" space and apply the ledger's sign afterwards.
 */
export function allocateMinutes(
  total: number,
  weights: readonly number[]
): number[] {
  const parts = weights.length;
  if (parts === 0) {
    return [];
  }

  const safeWeights = weights.map(weight => (weight > 0 ? weight : 0));
  const weightSum = safeWeights.reduce((sum, weight) => sum + weight, 0);
  // No signal to apportion by — split as evenly as the same rule would.
  const effective = weightSum > 0 ? safeWeights : safeWeights.map(() => 1);
  const effectiveSum = weightSum > 0 ? weightSum : parts;

  // Integer floor share, plus the exact remainder as an integer numerator, so
  // nothing ever becomes a float: floor(total * w / S) and (total * w) mod S.
  const shares = effective.map(weight => {
    const numerator = total * weight;
    return {
      base: Math.floor(numerator / effectiveSum),
      remainder: numerator % effectiveSum,
    };
  });

  const allocated = shares.map(share => share.base);
  let leftover = total - allocated.reduce((sum, part) => sum + part, 0);

  // Hand the leftover units out one each, largest remainder first, earliest
  // part winning a tie — deterministic, and the extra minute lands on the
  // first day rather than an arbitrary one.
  const order = shares
    .map((share, index) => ({ index, remainder: share.remainder }))
    .sort((a, b) =>
      b.remainder === a.remainder
        ? a.index - b.index
        : b.remainder - a.remainder
    );

  for (const { index } of order) {
    if (leftover <= 0) {
      break;
    }
    allocated[index] = (allocated[index] ?? 0) + 1;
    leftover -= 1;
  }

  return allocated;
}
