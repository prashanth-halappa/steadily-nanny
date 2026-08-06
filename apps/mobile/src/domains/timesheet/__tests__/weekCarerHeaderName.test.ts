/**
 * @module domains/timesheet/__tests__/weekCarerHeaderName.test
 *
 * Pattern A (pure function) — who gets named above a parent's Hours week.
 *
 * The failure this file guards: the header is printed over a PAY RECORD, so
 * naming the wrong carer is worse than naming nobody. An earlier version
 * picked the household's first nanny/helper and ignored whose entries were
 * actually on screen, which mislabelled carer B's hours with carer A's name
 * in any two-carer household.
 */
import { describe, expect, it } from 'bun:test';
import { resolveWeekCarerHeaderName } from '../utils/weekCarerHeaderName';

const NAMES: Record<string, string> = {
  'carer-a': 'Maria',
  'carer-b': 'Ada',
};
const resolveMemberName = (userId: string): string => NAMES[userId] ?? userId;

describe('resolveWeekCarerHeaderName', () => {
  it('names the carer whose entries these are', () => {
    expect(
      resolveWeekCarerHeaderName({
        entryCarerIds: ['carer-a'],
        entryCarerDisplayName: 'Maria',
        carerMemberIds: ['carer-a', 'carer-b'],
        resolveMemberName,
      })
    ).toBe('Maria');
  });

  it('REGRESSION: names nobody when the week spans two carers', () => {
    // Never attribute one carer's hours to another.
    expect(
      resolveWeekCarerHeaderName({
        entryCarerIds: ['carer-a', 'carer-b'],
        entryCarerDisplayName: 'Maria',
        carerMemberIds: ['carer-a', 'carer-b'],
        resolveMemberName,
      })
    ).toBeNull();
  });

  it('REGRESSION: a two-carer week names nobody even if only one carer remains a member', () => {
    // Pins the multi-carer guard itself. Carer B has since left the
    // household, so the sole-member fallback below would happily name
    // Maria over a week she only half worked — the guard must win first.
    expect(
      resolveWeekCarerHeaderName({
        entryCarerIds: ['carer-a', 'carer-b'],
        entryCarerDisplayName: 'Maria',
        carerMemberIds: ['carer-a'],
        resolveMemberName,
      })
    ).toBeNull();
  });

  it("REGRESSION: prefers the entry's carer over the first household member", () => {
    // `carer-b` worked; `carer-a` is first in the member list. The header
    // must say Ada, not Maria.
    expect(
      resolveWeekCarerHeaderName({
        entryCarerIds: ['carer-b'],
        entryCarerDisplayName: 'Ada',
        carerMemberIds: ['carer-a', 'carer-b'],
        resolveMemberName,
      })
    ).toBe('Ada');
  });

  // F1 (C1 round 2). The caller now passes the SELECTED TAB's carer key, not
  // a raw `carer_id`, so a departed carer arrives here as her
  // `household_member_id` — an id that is deliberately in no member list.
  // This is the branch that has to win: naming her from her own snapshot
  // rather than falling through to the sole-member fallback below, which is
  // exactly what printed the wrong carer's name over her pay record.
  it('names a departed carer from her snapshot, never the sole remaining member', () => {
    expect(
      resolveWeekCarerHeaderName({
        entryCarerIds: ['55555555-5555-4555-8555-555555555555'],
        entryCarerDisplayName: 'Emma',
        carerMemberIds: ['carer-a'],
        resolveMemberName,
      })
    ).toBe('Emma');
  });

  it('falls back to the sole carer on a week with no entries', () => {
    // The empty-week case: nothing logged yet, but "whose week is this?"
    // still has one unambiguous answer.
    expect(
      resolveWeekCarerHeaderName({
        entryCarerIds: [],
        entryCarerDisplayName: null,
        carerMemberIds: ['carer-a'],
        resolveMemberName,
      })
    ).toBe('Maria');
  });

  it('names nobody on an empty week when the household has two carers', () => {
    expect(
      resolveWeekCarerHeaderName({
        entryCarerIds: [],
        entryCarerDisplayName: null,
        carerMemberIds: ['carer-a', 'carer-b'],
        resolveMemberName,
      })
    ).toBeNull();
  });

  it('names nobody when there are no entries and no carers', () => {
    expect(
      resolveWeekCarerHeaderName({
        entryCarerIds: [],
        entryCarerDisplayName: null,
        carerMemberIds: [],
        resolveMemberName,
      })
    ).toBeNull();
  });

  it('returns null rather than a blank name when the entry carries none', () => {
    // A single known carer whose display name never resolved — an empty
    // interpolation reads as a rendering bug, so prefer no name at all.
    expect(
      resolveWeekCarerHeaderName({
        entryCarerIds: ['carer-a'],
        entryCarerDisplayName: null,
        carerMemberIds: ['carer-a'],
        resolveMemberName,
      })
    ).toBeNull();
  });
});
