/**
 * Documents the consent demotion predicate (migration 034 / apply_parent_shift_edit).
 */
import { describe, expect, it } from 'bun:test';
import { shouldDemoteOnParentTimeEdit } from '../../../../../src/domains/shift/utils/parentEditDemotion';

describe('shouldDemoteOnParentTimeEdit', () => {
  it('demotes confirmed when starts_at changes', () => {
    expect(shouldDemoteOnParentTimeEdit('confirmed', true, false)).toBe(true);
  });

  it('demotes confirmed when ends_at changes', () => {
    expect(shouldDemoteOnParentTimeEdit('confirmed', false, true)).toBe(true);
  });

  it('does not demote on note-only (both time flags false)', () => {
    expect(shouldDemoteOnParentTimeEdit('confirmed', false, false)).toBe(false);
  });

  it('does not demote pending / cancelled / completed even when times change', () => {
    expect(shouldDemoteOnParentTimeEdit('pending', true, true)).toBe(false);
    expect(shouldDemoteOnParentTimeEdit('cancelled', true, false)).toBe(false);
    expect(shouldDemoteOnParentTimeEdit('completed', false, true)).toBe(false);
  });
});
