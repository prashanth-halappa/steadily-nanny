/**
 * The wire edge — and the one number in 3-O that is worth a whole test file.
 *
 * §17/D23: NO client-side `rate x hours` may exist anywhere in this feature.
 * `weekly_equivalent_minor` is computed here, on the server, by the SAME
 * engine that prices a real week. The pin below is the spec's own worked
 * example: $28.00/hr with overtime after 40h and 50 guaranteed hours is
 * $1,540.00 (40 x 2800 + 10 x 4200), not the $1,400.00 a naive multiply
 * produces. A wrong weekly figure on the screen where the contract is agreed
 * is worse than no figure at all.
 *
 * @module tests/unit/domains/termsProposal/controllers/termsProposalController
 */
import { describe, expect, it } from 'bun:test';
import { withWeeklyEquivalent } from '../../../../../src/domains/termsProposal/controllers/termsProposalController';
import { proposal, terms } from '../services/fixtures';

describe('withWeeklyEquivalent — the server-computed figure (§7.2, §17)', () => {
  it('prices 50 guaranteed hours at $28.00 with OT after 40h as $1,540.00, NOT $1,400.00', () => {
    const wire = withWeeklyEquivalent(proposal() as any);
    expect(wire.weekly_equivalent_minor).toBe(154000);
    expect(wire.weekly_equivalent_minor).not.toBe(140000);
  });

  it('is null when there are no guaranteed hours — render nothing, never a fabricated figure (T16)', () => {
    const wire = withWeeklyEquivalent(
      proposal({
        terms: terms({ guaranteed_minutes_per_week: null }),
      }) as any
    );
    expect(wire.weekly_equivalent_minor).toBeNull();
  });

  it('is null when the guarantee is zero', () => {
    const wire = withWeeklyEquivalent(
      proposal({
        terms: terms({ guaranteed_minutes_per_week: 0 }),
      }) as any
    );
    expect(wire.weekly_equivalent_minor).toBeNull();
  });

  it('with no overtime tier, 40 guaranteed hours at $28.00 is the plain $1,120.00', () => {
    const wire = withWeeklyEquivalent(
      proposal({
        terms: terms({
          guaranteed_minutes_per_week: 2400,
          overtime_threshold_minutes: null,
        }),
      }) as any
    );
    expect(wire.weekly_equivalent_minor).toBe(112000);
  });

  it('leaves every other field of the row untouched', () => {
    const row = proposal() as any;
    const wire = withWeeklyEquivalent(row);
    expect(wire.id).toBe(row.id);
    expect(wire.terms).toEqual(row.terms);
    expect(wire.status).toBe('proposed');
  });
});
