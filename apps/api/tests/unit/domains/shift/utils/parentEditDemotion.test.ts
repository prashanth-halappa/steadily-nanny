/**
 * Documents the consent demotion predicate (migration 071 / apply_parent_shift_edit).
 */
import { describe, expect, it } from 'bun:test';
import { shouldDemoteOnParentTimeEdit } from '../../../../../src/domains/shift/utils/parentEditDemotion';

const LOCKED_START = '2026-08-03T08:00:00.000Z';
const LOCKED_END = '2026-08-03T17:00:00.000Z';

describe('shouldDemoteOnParentTimeEdit', () => {
  it('demotes confirmed when starts_at actually changes', () => {
    expect(
      shouldDemoteOnParentTimeEdit(
        'confirmed',
        LOCKED_START,
        LOCKED_END,
        true,
        false,
        '2026-08-03T09:00:00.000Z',
        null
      )
    ).toBe(true);
  });

  it('demotes confirmed when ends_at actually changes', () => {
    expect(
      shouldDemoteOnParentTimeEdit(
        'confirmed',
        LOCKED_START,
        LOCKED_END,
        false,
        true,
        null,
        '2026-08-03T18:00:00.000Z'
      )
    ).toBe(true);
  });

  it('does not demote when times are resent unchanged (flags set, values match)', () => {
    expect(
      shouldDemoteOnParentTimeEdit(
        'confirmed',
        LOCKED_START,
        LOCKED_END,
        true,
        true,
        LOCKED_START,
        LOCKED_END
      )
    ).toBe(false);
  });

  it('does not demote when the same instant is spelled differently', () => {
    expect(
      shouldDemoteOnParentTimeEdit(
        'confirmed',
        '2026-08-03T08:00:00+00:00',
        '2026-08-03T17:00:00+00:00',
        true,
        true,
        '2026-08-03T08:00:00.000Z',
        '2026-08-03T17:00:00.000Z'
      )
    ).toBe(false);
  });

  it('does not demote on note-only (both time flags false)', () => {
    expect(
      shouldDemoteOnParentTimeEdit(
        'confirmed',
        LOCKED_START,
        LOCKED_END,
        false,
        false,
        null,
        null
      )
    ).toBe(false);
  });

  it('does not demote pending / cancelled / completed even when times change', () => {
    expect(
      shouldDemoteOnParentTimeEdit(
        'pending',
        LOCKED_START,
        LOCKED_END,
        true,
        true,
        '2026-08-03T09:00:00.000Z',
        '2026-08-03T18:00:00.000Z'
      )
    ).toBe(false);
    expect(
      shouldDemoteOnParentTimeEdit(
        'cancelled',
        LOCKED_START,
        LOCKED_END,
        true,
        false,
        '2026-08-03T09:00:00.000Z',
        null
      )
    ).toBe(false);
    expect(
      shouldDemoteOnParentTimeEdit(
        'completed',
        LOCKED_START,
        LOCKED_END,
        false,
        true,
        null,
        '2026-08-03T18:00:00.000Z'
      )
    ).toBe(false);
  });
});
