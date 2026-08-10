/**
 * @module domains/timesheet/utils/paymentGroups
 *
 * Groups a payment ledger by settlement month and subtotals each currency
 * present within a month — the only arithmetic on the Payments screen.
 * Integer minor-unit arithmetic throughout (docs/11-MONEY.md §1); a month
 * with two currencies gets two subtotal entries, NEVER summed together —
 * the app has no FX rate (docs/11-MONEY.md §4), so collapsing currencies
 * would invent a conversion rate that does not exist.
 *
 * `paid_at` is a DATE string ('2026-08-16'), not a timestamp — the month
 * is read directly off the string so a timezone shift can never move a
 * payment into the wrong month. `created_at` is a full ISO datetime, used
 * only as the tie-break when two payments share a `paid_at`.
 *
 * Pure and dependency-free on purpose — same discipline as `paidState.ts`.
 */

/** Just the fields this module needs off a `Payment` row. */
export interface PaymentLike {
  amount_minor: number;
  currency: string;
  paid_at: string;
  created_at: string;
}

export interface CurrencySubtotal {
  currency: string;
  totalMinor: number;
}

export interface PaymentGroup<T extends PaymentLike = PaymentLike> {
  /** '2026-08' — sortable, locale-free. Formatting is the renderer's job. */
  monthKey: string;
  subtotals: readonly CurrencySubtotal[];
  payments: readonly T[];
}

/** Groups payments by month (newest first), each with per-currency subtotals. */
export function groupPaymentsByMonth<T extends PaymentLike>(
  payments: readonly T[]
): PaymentGroup<T>[] {
  const byMonth = new Map<string, T[]>();

  for (const payment of payments) {
    const monthKey = payment.paid_at.slice(0, 7);
    const rows = byMonth.get(monthKey);
    if (rows) {
      rows.push(payment);
    } else {
      byMonth.set(monthKey, [payment]);
    }
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monthKey, rows]) => ({
      monthKey,
      subtotals: subtotalByCurrency(rows),
      payments: sortNewestFirst(rows),
    }));
}

/** Newest `paid_at` first, `created_at` DESC as the tie-break. */
function sortNewestFirst<T extends PaymentLike>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.paid_at !== b.paid_at) return b.paid_at.localeCompare(a.paid_at);
    return b.created_at.localeCompare(a.created_at);
  });
}

/** Per-currency totals, ordered by first-seen currency in `rows`. */
function subtotalByCurrency(rows: readonly PaymentLike[]): CurrencySubtotal[] {
  const totals = new Map<string, number>();

  for (const row of rows) {
    totals.set(
      row.currency,
      (totals.get(row.currency) ?? 0) + row.amount_minor
    );
  }

  return Array.from(totals.entries()).map(([currency, totalMinor]) => ({
    currency,
    totalMinor,
  }));
}
