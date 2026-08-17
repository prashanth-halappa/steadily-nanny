import { describe, expect, it } from 'bun:test';
import { SCHEDULE_PATTERN_STATUSES } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { resolveNoWeekYet } from '../components/NoWeekYetCard.utils';

const never = () => false;
const WEEK = '2026-08-10';
const NEXT_WEEK = '2026-08-17';

const base = {
  householdId: 'hh-1',
  isNanny: true,
  isPastMember: false,
  householdIsLive: true,
  termsAgreed: true,
  patternStatus: null,
  declinedByHer: false,
  shiftCountNext14Days: 0,
  joinedCardShowing: false,
  weekStartISO: WEEK,
  isDismissed: never,
};

describe('resolveNoWeekYet', () => {
  it('shows the card to a live, terms-agreed nanny with no pattern and no shifts', () => {
    expect(resolveNoWeekYet(base)).toEqual({
      kind: 'card',
      afterDecline: false,
      dismissKey: `noWeekNanny:hh-1:${WEEK}`,
    });
  });

  // A draft is invisible to her, so from her side it reads exactly like no
  // pattern at all.
  it('shows the card when the only pattern is a draft', () => {
    const state = resolveNoWeekYet({
      ...base,
      patternStatus: SCHEDULE_PATTERN_STATUSES.DRAFT,
    });
    expect(state.kind).toBe('card');
  });

  it.each([
    ['withdrawn', SCHEDULE_PATTERN_STATUSES.WITHDRAWN],
    ['ended', SCHEDULE_PATTERN_STATUSES.ENDED],
  ])('shows the card when the resolved pattern is %s', (_label, status) => {
    expect(resolveNoWeekYet({ ...base, patternStatus: status }).kind).toBe(
      'card'
    );
  });

  describe('gates', () => {
    it('hides for a parent', () => {
      expect(resolveNoWeekYet({ ...base, isNanny: false }).kind).toBe('hidden');
    });

    it('hides for a past member', () => {
      expect(resolveNoWeekYet({ ...base, isPastMember: true }).kind).toBe(
        'hidden'
      );
    });

    it('hides when the household is not live', () => {
      expect(resolveNoWeekYet({ ...base, householdIsLive: false }).kind).toBe(
        'hidden'
      );
    });

    it('hides with no household id', () => {
      expect(resolveNoWeekYet({ ...base, householdId: null }).kind).toBe(
        'hidden'
      );
      expect(resolveNoWeekYet({ ...base, householdId: undefined }).kind).toBe(
        'hidden'
      );
    });

    // Before terms are agreed she is blocked and ClockInBlockedCard owns her
    // screen — a second card about a second missing thing is noise.
    it('hides before the pay terms are agreed', () => {
      expect(resolveNoWeekYet({ ...base, termsAgreed: false }).kind).toBe(
        'hidden'
      );
    });

    // One fact, one owner: a pending week is PendingScheduleCard's.
    it('hides while a pattern is pending', () => {
      expect(
        resolveNoWeekYet({
          ...base,
          patternStatus: SCHEDULE_PATTERN_STATUSES.PENDING,
        }).kind
      ).toBe('hidden');
    });

    it('hides once a pattern is accepted', () => {
      expect(
        resolveNoWeekYet({
          ...base,
          patternStatus: SCHEDULE_PATTERN_STATUSES.ACCEPTED,
        }).kind
      ).toBe('hidden');
    });

    // The gate that keeps the card honest: a household running entirely on
    // one-off shifts never sees it.
    it('hides when she has any shift in the next 14 days', () => {
      expect(resolveNoWeekYet({ ...base, shiftCountNext14Days: 1 }).kind).toBe(
        'hidden'
      );
    });

    // Her first impression of a new family is the welcome, not a to-do.
    it('hides while the joined-household card is showing', () => {
      expect(resolveNoWeekYet({ ...base, joinedCardShowing: true }).kind).toBe(
        'hidden'
      );
    });

    it('hides when several gates fail at once', () => {
      expect(
        resolveNoWeekYet({
          ...base,
          isNanny: false,
          termsAgreed: false,
          shiftCountNext14Days: 3,
          joinedCardShowing: true,
        }).kind
      ).toBe('hidden');
    });
  });

  describe('afterDecline', () => {
    it('is true when she declined the most recent pattern', () => {
      expect(
        resolveNoWeekYet({
          ...base,
          patternStatus: SCHEDULE_PATTERN_STATUSES.DECLINED,
          declinedByHer: true,
        })
      ).toEqual({
        kind: 'card',
        afterDecline: true,
        dismissKey: `noWeekNanny:hh-1:${WEEK}`,
      });
    });

    // Declined by someone else (or withdrawn out from under her) is not her
    // decline — the copy must not claim she declined.
    it('is false when the decline was not hers', () => {
      const state = resolveNoWeekYet({
        ...base,
        patternStatus: SCHEDULE_PATTERN_STATUSES.DECLINED,
        declinedByHer: false,
      });
      expect(state).toEqual({
        kind: 'card',
        afterDecline: false,
        dismissKey: `noWeekNanny:hh-1:${WEEK}`,
      });
    });
  });

  describe('the weekly dismissal', () => {
    const hidThisWeek = (key: string) => key === `noWeekNanny:hh-1:${WEEK}`;

    it('hides for the rest of the week it was dismissed in', () => {
      expect(resolveNoWeekYet({ ...base, isDismissed: hidThisWeek }).kind).toBe(
        'hidden'
      );
    });

    // At most once per week, on her first Today open in a new empty week. It
    // never counts and never escalates.
    it('re-arms in the next week', () => {
      const state = resolveNoWeekYet({
        ...base,
        weekStartISO: NEXT_WEEK,
        isDismissed: hidThisWeek,
      });
      expect(state).toEqual({
        kind: 'card',
        afterDecline: false,
        dismissKey: `noWeekNanny:hh-1:${NEXT_WEEK}`,
      });
    });

    it('keys per household, so hiding it in one family does not hide it in another', () => {
      expect(
        resolveNoWeekYet({
          ...base,
          householdId: 'hh-2',
          isDismissed: hidThisWeek,
        }).kind
      ).toBe('card');
    });
  });
});
