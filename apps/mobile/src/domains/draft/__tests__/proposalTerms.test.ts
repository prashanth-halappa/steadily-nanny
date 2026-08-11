/**
 * @module domains/draft/__tests__/proposalTerms
 *
 * The adapter that lets a `terms_proposals` payload feed the SAME
 * `buildTermRows` the parent's and nanny's pay cards already use. Two rules
 * are load-bearing:
 *
 *  - Null stays null. "No cancellation pay" is an agreement, "Not set" is a
 *    blank, and a fabricated 0 is forbidden (T16).
 *  - Nothing here computes a weekly figure. The only weekly number this
 *    screen may print is the server's `weekly_equivalent_minor` (§17).
 */
import { describe, expect, it } from 'bun:test';
import type { CreatePayArrangementRequest } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { buildTermRows } from '@/src/domains/pay/utils/termRows';
import {
  proposalTermsToArrangement,
  weeklyEquivalentAmount,
} from '../utils/proposalTerms';
import { draftProposal } from './fixtures';

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

const terms: CreatePayArrangementRequest = {
  rate_minor: 2800,
  currency: 'USD',
  overtime_threshold_minutes: 2400,
  overtime_multiplier: 1.5,
  guaranteed_minutes_per_week: 3000,
  valid_from: '2026-08-17',
};

describe('proposalTermsToArrangement', () => {
  it('carries the terms she wrote through unchanged', () => {
    const arrangement = proposalTermsToArrangement(terms, {
      proposalId: 'proposal-1',
      householdId: 'household-1',
      carerId: 'nanny-1',
      carerDisplayName: 'Marisol',
    });

    expect(arrangement.rate_minor).toBe(2800);
    expect(arrangement.currency).toBe('USD');
    expect(arrangement.overtime_threshold_minutes).toBe(2400);
    expect(arrangement.guaranteed_minutes_per_week).toBe(3000);
    expect(arrangement.valid_from).toBe('2026-08-17');
  });

  it('leaves an unstated term null rather than inventing a zero', () => {
    const arrangement = proposalTermsToArrangement(terms, {
      proposalId: 'proposal-1',
      householdId: 'household-1',
      carerId: 'nanny-1',
      carerDisplayName: 'Marisol',
    });

    expect(arrangement.cancellation_paid_within_hours).toBeNull();
    expect(arrangement.mileage_rate_per_mile_minor).toBeNull();
    expect(arrangement.pto_entitlement_minutes_per_year).toBeNull();
    expect(arrangement.worked_holiday_multiplier).toBeNull();
  });

  it('never carries a weekly equivalent of its own', () => {
    const arrangement = proposalTermsToArrangement(terms, {
      proposalId: 'proposal-1',
      householdId: 'household-1',
      carerId: 'nanny-1',
      carerDisplayName: 'Marisol',
    });

    // The figure belongs to the proposal, computed server-side. If this
    // object ever grew one, a client multiply would have somewhere to hide.
    expect(arrangement.weekly_equivalent_minor).toBeUndefined();
  });

  it('feeds buildTermRows so the draft and the pay card cannot drift', () => {
    const rows = buildTermRows(
      proposalTermsToArrangement(terms, {
        proposalId: 'proposal-1',
        householdId: 'household-1',
        carerId: 'nanny-1',
        carerDisplayName: 'Marisol',
      }),
      t,
      null
    );

    const cancellations = rows.find(row => row.key === 'cancellations');
    expect(cancellations?.value).toBeNull();
    // T16: an explicit no, never "Not set" and never a fabricated $0.00.
    expect(cancellations?.valueWhenNull).toBe('noCancellationPay');

    const mileage = rows.find(row => row.key === 'mileage');
    expect(mileage?.value).toBeNull();
    expect(mileage?.valueWhenNull).toBeUndefined();
  });
});

describe('weeklyEquivalentAmount', () => {
  it("prints the server's figure, which overtime makes bigger than rate x hours", () => {
    // $28.00/hr, overtime after 40h, 50 guaranteed hours.
    const amount = weeklyEquivalentAmount(draftProposal);

    expect(amount).toContain('1,540.00');
    // 28 x 50 = 1,400.00 — the multiply that ignores overtime, and the exact
    // error David named as his own trust-killer.
    expect(amount).not.toContain('1,400.00');
  });

  it('renders nothing rather than a figure it cannot stand behind', () => {
    expect(
      weeklyEquivalentAmount({
        ...draftProposal,
        weekly_equivalent_minor: null,
      })
    ).toBeNull();
  });

  it('takes the answer, not the ingredients — a rate change alone moves nothing', () => {
    const doubled = weeklyEquivalentAmount({
      ...draftProposal,
      terms: { ...draftProposal.terms, rate_minor: 5600 },
    });

    // The hourly rate is not an input. Only the server's own figure is.
    expect(doubled).toBe(weeklyEquivalentAmount(draftProposal));
  });
});
