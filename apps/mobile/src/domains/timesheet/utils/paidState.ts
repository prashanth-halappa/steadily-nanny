/**
 * @module domains/timesheet/utils/paidState
 *
 * "Has this week actually been paid?" — derived from the settlement ledger
 * (067 `payments`) against the week's frozen gross, in integer minor units
 * end to end (docs/11-MONEY.md §1). No floats, no `/ 100` anywhere: this is
 * the figure the person owed the money reads.
 *
 * `grossMinor` is `number | null` and is NEVER defaulted with `?? 0` at a
 * call site — the same discipline `ReimbursementsCard` documents for
 * `reimbursements_minor`. A `no_arrangement`, `currency_change` or legacy
 * `hours_only` week, or a failed earnings fetch, has NO server total; a
 * zero there would render "Paid" over a week whose value is simply unknown.
 * `derivePaidState` returns `null` in that case and the card withholds the
 * badge rather than inventing one.
 *
 * Pure and dependency-free on purpose — the arithmetic that decides whether a
 * nanny is told she has been paid should be testable without a renderer.
 */

/** Just the field this module needs off a `Payment` — the ledger row's amount. */
interface PaymentAmount {
  amount_minor: number;
}

export type PaidStatus = 'unpaid' | 'partial' | 'paid';

export interface WeekPaidState {
  status: PaidStatus;
  /** Sum of every recorded payment, minor units. */
  paidMinor: number;
  /** The week's gross (frozen once approved), minor units. */
  grossMinor: number;
  /** What is still owed, floored at zero — see `derivePaidState`. */
  balanceMinor: number;
}

/** Total of a week's ledger in minor units. Empty ledger sums to zero. */
export function sumPaymentsMinor(payments: readonly PaymentAmount[]): number {
  return payments.reduce((total, p) => total + p.amount_minor, 0);
}

/**
 * The week's paid state, or `null` when there is no server gross to measure
 * against (see the module doc — a missing total is not a zero total).
 *
 * The balance FLOORS at zero. The server refuses an over-payment at write
 * time, but a week that was reopened and re-approved at a lower gross can
 * leave a ledger already above it — and "-£50.00 still to pay" is not a
 * sentence anyone should be shown. Such a week reads as paid, which is true.
 */
export function derivePaidState(
  payments: readonly PaymentAmount[],
  grossMinor: number | null
): WeekPaidState | null {
  if (grossMinor === null) return null;

  const paidMinor = sumPaymentsMinor(payments);
  const balanceMinor = Math.max(0, grossMinor - paidMinor);
  const status: PaidStatus =
    balanceMinor === 0 ? 'paid' : paidMinor === 0 ? 'unpaid' : 'partial';

  return { status, paidMinor, grossMinor, balanceMinor };
}
