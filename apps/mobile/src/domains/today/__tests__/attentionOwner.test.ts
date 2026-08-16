/**
 * @module domains/today/__tests__/attentionOwner.test
 *
 * "One T1 per screen" precedence — the third time an attention-surface
 * collision shipped (inbox+pattern, inbox+overdue, inbox+coverage-gap) is
 * one collision too many for another ad-hoc boolean. One ranked decision,
 * stated and tested here, is what the next attention surface must extend
 * instead of colliding with.
 */
import { describe, expect, it } from 'bun:test';
import { resolveAttentionOwner } from '../utils/attentionOwner';

describe('resolveAttentionOwner', () => {
  it('nothing needs attention -> no owner', () => {
    expect(
      resolveAttentionOwner({
        overdue: false,
        hasUncoveredCare: false,
        hasInboxItems: false,
      })
    ).toBeNull();
  });

  it('overdue clock-out wins over everything — corrupts the pay record while unresolved', () => {
    expect(
      resolveAttentionOwner({
        overdue: true,
        hasUncoveredCare: true,
        hasInboxItems: true,
      })
    ).toBe('overdue');
  });

  it('a coverage gap wins over an inbox item — a child may be uncovered right now', () => {
    expect(
      resolveAttentionOwner({
        overdue: false,
        hasUncoveredCare: true,
        hasInboxItems: true,
      })
    ).toBe('uncoveredCare');
  });

  // §7.1 — the rung this slice adds, and both of its neighbours are asserted
  // in the same file so the ordering cannot drift one way or the other.
  it('a coverage gap wins over a terms proposal — a child with nobody booked outranks a contract', () => {
    expect(
      resolveAttentionOwner({
        overdue: false,
        hasUncoveredCare: true,
        hasTermsProposal: true,
        hasInboxItems: true,
      })
    ).toBe('uncoveredCare');
  });

  it('a terms proposal wins over an inbox item — it blocks every future figure', () => {
    expect(
      resolveAttentionOwner({
        overdue: false,
        hasUncoveredCare: false,
        hasTermsProposal: true,
        hasInboxItems: true,
      })
    ).toBe('termsProposal');
  });

  it('inbox items own attention only once nothing more urgent is true', () => {
    expect(
      resolveAttentionOwner({
        overdue: false,
        hasUncoveredCare: false,
        hasTermsProposal: false,
        hasInboxItems: true,
      })
    ).toBe('inbox');
  });

  // Callers that predate the rung keep compiling and keep their behaviour —
  // an omitted flag is "no proposal", never a silently-owned T1 slot.
  it('treats an omitted proposal flag as no proposal', () => {
    expect(
      resolveAttentionOwner({
        overdue: false,
        hasUncoveredCare: false,
        hasInboxItems: true,
      })
    ).toBe('inbox');
  });

  // A5/A1 — the rung the clock-in hard block adds, at the TOP. Both
  // neighbours asserted here so the ordering cannot drift either way.
  it('a terms block wins over an overdue clock-out — the block stops the record existing at all', () => {
    expect(
      resolveAttentionOwner({
        termsBlocked: true,
        overdue: true,
        hasUncoveredCare: true,
        hasTermsProposal: true,
        hasInboxItems: true,
      })
    ).toBe('termsBlocked');
  });

  it('treats an omitted termsBlocked flag as not blocked', () => {
    expect(
      resolveAttentionOwner({
        overdue: true,
        hasUncoveredCare: false,
        hasInboxItems: false,
      })
    ).toBe('overdue');
  });
});
