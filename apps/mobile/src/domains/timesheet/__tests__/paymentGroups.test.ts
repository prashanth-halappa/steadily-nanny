/**
 * @module domains/timesheet/__tests__/paymentGroups.test
 *
 * `groupPaymentsByMonth` computes the only arithmetic on the Payments
 * screen — grouping payment rows by settlement month and subtotalling each
 * currency present. Integer minor-unit arithmetic throughout
 * (docs/11-MONEY.md §1); no currency is ever summed into another, because
 * the app has no FX rate (docs/11-MONEY.md §4).
 */
import { describe, expect, it } from 'bun:test';
import { groupPaymentsByMonth } from '../utils/paymentGroups';

const payment = (
  amount_minor: number,
  currency: string,
  paid_at: string,
  created_at = `${paid_at}T12:00:00+00:00`
) => ({ amount_minor, currency, paid_at, created_at });

describe('groupPaymentsByMonth', () => {
  it('is empty for empty input — never a group with a fabricated zero', () => {
    expect(groupPaymentsByMonth([])).toEqual([]);
  });

  it('sums a single currency across the month into one subtotal entry', () => {
    const groups = groupPaymentsByMonth([
      payment(1000, 'GBP', '2026-08-01'),
      payment(2000, 'GBP', '2026-08-15'),
      payment(500, 'GBP', '2026-08-20'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.monthKey).toBe('2026-08');
    expect(groups[0]?.subtotals).toEqual([
      { currency: 'GBP', totalMinor: 3500 },
    ]);
  });

  it('two currencies in one month stay separate — the app has no FX rate', () => {
    const groups = groupPaymentsByMonth([
      payment(1000, 'GBP', '2026-08-01'),
      payment(2000, 'USD', '2026-08-15'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.subtotals).toEqual([
      { currency: 'GBP', totalMinor: 1000 },
      { currency: 'USD', totalMinor: 2000 },
    ]);
  });

  it('three currencies in one month each get their own subtotal entry', () => {
    const groups = groupPaymentsByMonth([
      payment(1000, 'GBP', '2026-08-01'),
      payment(2000, 'USD', '2026-08-15'),
      payment(3000, 'EUR', '2026-08-20'),
    ]);

    expect(groups[0]?.subtotals).toEqual([
      { currency: 'GBP', totalMinor: 1000 },
      { currency: 'USD', totalMinor: 2000 },
      { currency: 'EUR', totalMinor: 3000 },
    ]);
  });

  it('does not pad subtotals when a month is genuinely single-currency', () => {
    const groups = groupPaymentsByMonth([
      payment(1000, 'GBP', '2026-08-01'),
      payment(2000, 'GBP', '2026-08-15'),
    ]);

    expect(groups[0]?.subtotals).toHaveLength(1);
  });

  it('splits rows spanning two months into two groups with the right members', () => {
    const groups = groupPaymentsByMonth([
      payment(1000, 'GBP', '2026-08-05'),
      payment(2000, 'GBP', '2026-09-05'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.monthKey).sort()).toEqual(['2026-08', '2026-09']);
    const augGroup = groups.find(g => g.monthKey === '2026-08');
    const sepGroup = groups.find(g => g.monthKey === '2026-09');
    expect(augGroup?.payments).toHaveLength(1);
    expect(sepGroup?.payments).toHaveLength(1);
  });

  it('sorts a payment on the 1st and one on the 31st into the correct months at the boundary', () => {
    const groups = groupPaymentsByMonth([
      payment(1000, 'GBP', '2026-08-31'),
      payment(2000, 'GBP', '2026-09-01'),
    ]);

    const augGroup = groups.find(g => g.monthKey === '2026-08');
    const sepGroup = groups.find(g => g.monthKey === '2026-09');
    expect(augGroup?.subtotals).toEqual([
      { currency: 'GBP', totalMinor: 1000 },
    ]);
    expect(sepGroup?.subtotals).toEqual([
      { currency: 'GBP', totalMinor: 2000 },
    ]);
  });

  it('orders groups newest month first', () => {
    const groups = groupPaymentsByMonth([
      payment(1000, 'GBP', '2026-06-05'),
      payment(2000, 'GBP', '2026-08-05'),
      payment(3000, 'GBP', '2026-07-05'),
    ]);

    expect(groups.map(g => g.monthKey)).toEqual([
      '2026-08',
      '2026-07',
      '2026-06',
    ]);
  });

  it('orders rows within a group by newest paid_at first, created_at DESC as the tie-break', () => {
    const groups = groupPaymentsByMonth([
      payment(1000, 'GBP', '2026-08-05', '2026-08-05T09:00:00+00:00'),
      payment(2000, 'GBP', '2026-08-20', '2026-08-20T09:00:00+00:00'),
      // same paid_at as the row above; created later, so it should come first
      payment(3000, 'GBP', '2026-08-20', '2026-08-20T15:00:00+00:00'),
    ]);

    expect(groups[0]?.payments.map(p => p.amount_minor)).toEqual([
      3000, 2000, 1000,
    ]);
  });

  it('orders subtotals deterministically by first-seen currency within the group', () => {
    const groups = groupPaymentsByMonth([
      payment(1000, 'USD', '2026-08-01'),
      payment(2000, 'GBP', '2026-08-02'),
      payment(3000, 'USD', '2026-08-03'),
    ]);

    expect(groups[0]?.subtotals.map(s => s.currency)).toEqual(['USD', 'GBP']);
  });

  it('sums large values near MAX_MONEY_MINOR without float drift', () => {
    const groups = groupPaymentsByMonth([
      payment(99_999_999, 'GBP', '2026-08-01'),
      payment(99_999_999, 'GBP', '2026-08-02'),
    ]);

    expect(groups[0]?.subtotals).toEqual([
      { currency: 'GBP', totalMinor: 199_999_998 },
    ]);
  });

  it('keeps a richer row type T flowing through unchanged, so callers do not lose joined fields', () => {
    const richPayment = {
      ...payment(1000, 'GBP', '2026-08-01'),
      week_label: 'w/c 27 Jul',
    };

    const groups = groupPaymentsByMonth([richPayment]);

    expect(groups[0]?.payments[0]?.week_label).toBe('w/c 27 Jul');
  });
});
