/**
 * @module domains/timesheet/__tests__/paidState.test
 *
 * The Paid / Partially paid / Unpaid derivation. Integer arithmetic in minor
 * units end to end (docs/11-MONEY.md §1) — a float anywhere in here would put
 * a wrong balance in front of the person owed the money.
 */
import { describe, expect, it } from 'bun:test';
import { derivePaidState, sumPaymentsMinor } from '../utils/paidState';

const payment = (amount_minor: number, paid_at = '2026-08-11') =>
  ({ amount_minor, paid_at }) as never;

describe('sumPaymentsMinor', () => {
  it('sums an empty ledger to zero', () => {
    expect(sumPaymentsMinor([])).toBe(0);
  });

  it('sums in minor units, never touching floats', () => {
    expect(sumPaymentsMinor([payment(1010), payment(2020), payment(1)])).toBe(
      3031
    );
  });
});

describe('derivePaidState', () => {
  it('is null when the week has no server gross — a balance must never be invented', () => {
    // `no_arrangement` / `currency_change` / legacy `hours_only` weeks and a
    // failed earnings fetch all arrive here as a null gross. Defaulting to 0
    // would render "Paid" over a week whose value is simply unknown.
    expect(derivePaidState([payment(5000)], null)).toBeNull();
  });

  it('reports unpaid with the full gross outstanding when nothing is recorded', () => {
    expect(derivePaidState([], 23612)).toEqual({
      status: 'unpaid',
      paidMinor: 0,
      grossMinor: 23612,
      balanceMinor: 23612,
    });
  });

  it('reports partial with the EXACT remainder — 23612 gross less 12000 paid is 11612', () => {
    expect(derivePaidState([payment(12000)], 23612)).toEqual({
      status: 'partial',
      paidMinor: 12000,
      grossMinor: 23612,
      balanceMinor: 11612,
    });
  });

  it('adds up several partial payments before deciding', () => {
    expect(derivePaidState([payment(10000), payment(3612)], 23612)).toEqual({
      status: 'partial',
      paidMinor: 13612,
      grossMinor: 23612,
      balanceMinor: 10000,
    });
  });

  it('reports paid when the ledger exactly settles the frozen gross', () => {
    expect(derivePaidState([payment(23612)], 23612)).toEqual({
      status: 'paid',
      paidMinor: 23612,
      grossMinor: 23612,
      balanceMinor: 0,
    });
  });

  it('never reports a NEGATIVE balance, even if history somehow exceeds the gross', () => {
    // The server refuses an over-payment, but a week reopened and re-approved
    // at a LOWER gross can leave the ledger above it. "-£50.00 still to pay"
    // is not a sentence; the balance floors at zero and the state is paid.
    expect(derivePaidState([payment(30000)], 23612)).toEqual({
      status: 'paid',
      paidMinor: 30000,
      grossMinor: 23612,
      balanceMinor: 0,
    });
  });
});
