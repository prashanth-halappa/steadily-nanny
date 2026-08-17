/**
 * @module domains/schedule/__tests__/WeeklyHoursNotSetCard.utils.test
 *
 * The card that tells a parent "nothing is scheduled and you are the one who
 * has to send it". Every gate is tested on its own, because each one exists
 * to keep the card off somebody's screen: a helper who cannot act on it, a
 * household still in draft, a relationship where the week is already with
 * her, and the celebration frame where a to-do about the same nanny would
 * step on the moment.
 *
 * THE RE-ARM IS THE POINT. The dismiss key carries the REASON, so hiding
 * "you haven't set a week" must not also hide "she declined the week you
 * sent" — the same trick `resolveInviteWaiting` plays by keying on the
 * invite id rather than the household.
 */
import { describe, expect, it } from 'bun:test';
import type { SchedulePatternStatus } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import {
  resolveWeeklyHoursNotSet,
  type WeeklyHoursNotSetReason,
  type WeeklyHoursNotSetVariant,
} from '../components/WeeklyHoursNotSetCard.utils';

const never = () => false;

const base = {
  householdId: 'hh-1',
  carerUserId: 'carer-1',
  isParentEditor: true,
  isPastMember: false,
  householdIsLive: true,
  hasActiveNanny: true,
  termsAgreed: true,
  patternStatus: null as SchedulePatternStatus | null,
  momentShowing: false,
  isDismissed: never,
};

describe('resolveWeeklyHoursNotSet — the gates', () => {
  it('shows the setup card once she has joined and terms are agreed', () => {
    const state = resolveWeeklyHoursNotSet(base);
    expect(state).toEqual({
      kind: 'card',
      reason: 'none',
      variant: 'setup',
      dismissKey: 'weeklyHoursNotSet:hh-1:carer-1:none',
    });
  });

  // A helper cannot send a usual week, so the card would be a to-do with no
  // door on it.
  it('gives a helper nothing', () => {
    expect(
      resolveWeeklyHoursNotSet({ ...base, isParentEditor: false }).kind
    ).toBe('hidden');
  });

  it('gives a removed parent nothing', () => {
    expect(resolveWeeklyHoursNotSet({ ...base, isPastMember: true }).kind).toBe(
      'hidden'
    );
  });

  it('stays off while the household is still a draft', () => {
    expect(
      resolveWeeklyHoursNotSet({ ...base, householdIsLive: false }).kind
    ).toBe('hidden');
  });

  it('stays off until a nanny is actually active', () => {
    expect(
      resolveWeeklyHoursNotSet({ ...base, hasActiveNanny: false }).kind
    ).toBe('hidden');
  });

  it('stays off while the carer is unknown', () => {
    expect(resolveWeeklyHoursNotSet({ ...base, carerUserId: null }).kind).toBe(
      'hidden'
    );
    expect(
      resolveWeeklyHoursNotSet({ ...base, carerUserId: undefined }).kind
    ).toBe('hidden');
  });

  it('stays off while the household is unknown', () => {
    expect(resolveWeeklyHoursNotSet({ ...base, householdId: null }).kind).toBe(
      'hidden'
    );
  });

  // An active nanny with no agreed pay is a different conversation, and pay
  // owns that screen.
  it('stays off until pay terms are agreed', () => {
    expect(resolveWeeklyHoursNotSet({ ...base, termsAgreed: false }).kind).toBe(
      'hidden'
    );
  });

  // From `pending` onward the Schedule tab's banner owns "it's with her".
  it('disappears the moment the week is with her', () => {
    expect(
      resolveWeeklyHoursNotSet({ ...base, patternStatus: 'pending' }).kind
    ).toBe('hidden');
  });

  it('disappears once she has accepted', () => {
    expect(
      resolveWeeklyHoursNotSet({ ...base, patternStatus: 'accepted' }).kind
    ).toBe('hidden');
  });

  // A once-per-relationship celebration must not share a screen with a
  // to-do about the same relationship.
  it('yields to the nanny-joined moment', () => {
    expect(
      resolveWeeklyHoursNotSet({ ...base, momentShowing: true }).kind
    ).toBe('hidden');
  });

  it('stays hidden once dismissed for this reason', () => {
    expect(
      resolveWeeklyHoursNotSet({
        ...base,
        isDismissed: key => key === 'weeklyHoursNotSet:hh-1:carer-1:none',
      }).kind
    ).toBe('hidden');
  });

  it('hides when several gates fail at once', () => {
    expect(
      resolveWeeklyHoursNotSet({
        ...base,
        isParentEditor: false,
        householdIsLive: false,
        hasActiveNanny: false,
        termsAgreed: false,
        momentShowing: true,
      }).kind
    ).toBe('hidden');
  });
});

describe('resolveWeeklyHoursNotSet — reason and variant', () => {
  const cases: Array<
    [
      SchedulePatternStatus | null,
      WeeklyHoursNotSetReason,
      WeeklyHoursNotSetVariant,
    ]
  > = [
    [null, 'none', 'setup'],
    ['draft', 'draft', 'draft'],
    ['declined', 'declined', 'declined'],
    ['withdrawn', 'withdrawn', 'setup'],
    ['ended', 'ended', 'setup'],
  ];

  for (const [patternStatus, reason, variant] of cases) {
    it(`maps ${patternStatus ?? 'no pattern'} to ${reason}/${variant}`, () => {
      const state = resolveWeeklyHoursNotSet({ ...base, patternStatus });
      expect(state).toEqual({
        kind: 'card',
        reason,
        variant,
        dismissKey: `weeklyHoursNotSet:hh-1:carer-1:${reason}`,
      });
    });
  }
});

describe('resolveWeeklyHoursNotSet — the reason token re-arms the card', () => {
  const hidNone = (key: string) =>
    key === 'weeklyHoursNotSet:hh-1:carer-1:none';

  it('re-arms when a week she sent is declined', () => {
    const state = resolveWeeklyHoursNotSet({
      ...base,
      patternStatus: 'declined',
      isDismissed: hidNone,
    });
    expect(state.kind).toBe('card');
  });

  it('re-arms when the week is withdrawn', () => {
    expect(
      resolveWeeklyHoursNotSet({
        ...base,
        patternStatus: 'withdrawn',
        isDismissed: hidNone,
      }).kind
    ).toBe('card');
  });

  it('re-arms when the week ends', () => {
    expect(
      resolveWeeklyHoursNotSet({
        ...base,
        patternStatus: 'ended',
        isDismissed: hidNone,
      }).kind
    ).toBe('card');
  });

  // Each reason is dismissed on its own; hiding the declined card must not
  // reach back and hide the one she has already hidden anyway.
  it('honours a dismissal of the reason actually showing', () => {
    expect(
      resolveWeeklyHoursNotSet({
        ...base,
        patternStatus: 'declined',
        isDismissed: key => key === 'weeklyHoursNotSet:hh-1:carer-1:declined',
      }).kind
    ).toBe('hidden');
  });

  it('keys the dismissal per relationship, not per household', () => {
    const state = resolveWeeklyHoursNotSet({ ...base, carerUserId: 'carer-2' });
    expect(state).toMatchObject({
      dismissKey: 'weeklyHoursNotSet:hh-1:carer-2:none',
    });
  });
});
