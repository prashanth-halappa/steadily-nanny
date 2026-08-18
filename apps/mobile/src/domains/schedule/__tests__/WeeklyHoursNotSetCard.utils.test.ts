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
  groupWeeklyHoursNotSetCards,
  resolveWeeklyHoursNotSet,
  type WeeklyHoursNotSetReason,
  type WeeklyHoursNotSetState,
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

// S7: `carers.data?.[0]` used to be the whole story. A second nanny with no
// week set was invisible; a second nanny with a declined week was invisible.
describe('groupWeeklyHoursNotSetCards', () => {
  const hidden: WeeklyHoursNotSetState = { kind: 'hidden' };
  const setupCard = (
    carerUserId: string,
    reason: WeeklyHoursNotSetReason = 'none'
  ): { carerUserId: string; state: WeeklyHoursNotSetState } => ({
    carerUserId,
    state: {
      kind: 'card',
      reason,
      variant: 'setup',
      dismissKey: `weeklyHoursNotSet:hh-1:${carerUserId}:${reason}`,
    },
  });
  const draftCard = (
    carerUserId: string
  ): { carerUserId: string; state: WeeklyHoursNotSetState } => ({
    carerUserId,
    state: {
      kind: 'card',
      reason: 'draft',
      variant: 'draft',
      dismissKey: `weeklyHoursNotSet:hh-1:${carerUserId}:draft`,
    },
  });
  const declinedCard = (
    carerUserId: string
  ): { carerUserId: string; state: WeeklyHoursNotSetState } => ({
    carerUserId,
    state: {
      kind: 'card',
      reason: 'declined',
      variant: 'declined',
      dismissKey: `weeklyHoursNotSet:hh-1:${carerUserId}:declined`,
    },
  });

  it('returns nothing when every carer is hidden', () => {
    expect(
      groupWeeklyHoursNotSetCards([
        { carerUserId: 'carer-1', state: hidden },
        { carerUserId: 'carer-2', state: hidden },
      ])
    ).toEqual([]);
  });

  it('one carer, setup: a single-carer setup group', () => {
    expect(groupWeeklyHoursNotSetCards([setupCard('carer-1')])).toEqual([
      {
        kind: 'setup',
        carerUserIds: ['carer-1'],
        dismissKeys: ['weeklyHoursNotSet:hh-1:carer-1:none'],
      },
    ]);
  });

  it('two carers, both setup: ONE combined group naming both', () => {
    const groups = groupWeeklyHoursNotSetCards([
      setupCard('carer-1'),
      setupCard('carer-2', 'withdrawn'),
    ]);
    expect(groups).toEqual([
      {
        kind: 'setup',
        carerUserIds: ['carer-1', 'carer-2'],
        dismissKeys: [
          'weeklyHoursNotSet:hh-1:carer-1:none',
          'weeklyHoursNotSet:hh-1:carer-2:withdrawn',
        ],
      },
    ]);
  });

  it('draft and declined stay ONE group per carer, never joined', () => {
    const groups = groupWeeklyHoursNotSetCards([
      draftCard('carer-1'),
      declinedCard('carer-2'),
    ]);
    expect(groups).toEqual([
      { kind: 'draft', carerUserId: 'carer-1', dismissKey: expect.any(String) },
      {
        kind: 'declined',
        carerUserId: 'carer-2',
        dismissKey: expect.any(String),
      },
    ]);
  });

  it('a mix: setup carers combine, draft/declined carers stay separate', () => {
    const groups = groupWeeklyHoursNotSetCards([
      setupCard('carer-1'),
      draftCard('carer-2'),
      setupCard('carer-3'),
      declinedCard('carer-4'),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({
      kind: 'setup',
      carerUserIds: ['carer-1', 'carer-3'],
    });
    expect(groups[1]).toMatchObject({ kind: 'draft', carerUserId: 'carer-2' });
    expect(groups[2]).toMatchObject({
      kind: 'declined',
      carerUserId: 'carer-4',
    });
  });
});
