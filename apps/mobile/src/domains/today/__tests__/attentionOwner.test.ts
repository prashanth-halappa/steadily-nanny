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

  it('inbox items own attention only once nothing more urgent is true', () => {
    expect(
      resolveAttentionOwner({
        overdue: false,
        hasUncoveredCare: false,
        hasInboxItems: true,
      })
    ).toBe('inbox');
  });
});
