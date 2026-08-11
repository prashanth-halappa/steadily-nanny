/**
 * @module __tests__/declinedShiftNeverCounts
 *
 * THE REGRESSION PIN for the 10 Aug 2026 incident, asserted at the shared
 * decision points rather than per-screen.
 *
 * Household 1 had FOUR shifts for one carer on 10 Aug: a DECLINED 06:00–20:00,
 * two CANCELLED, and one CONFIRMED 11:22–19:22. Six surfaces hand-rolled
 * `status !== 'cancelled'` instead of importing COVERING_SHIFT_STATUSES, so the
 * declined shift counted as real. Then an "earliest starts_at" reduction let it
 * OUTRANK and hide the confirmed one.
 *
 * The parent was told "H1 Nanny1 · Due 6:00 AM–8:00 PM" for a shift the nanny
 * had refused. The nanny's own clock card told her the same thing — so the
 * parent's bug made them expect her, and hers would have made her turn up.
 *
 * Two distinct failures are pinned here, because fixing only the filter still
 * leaves the wrong shift winning whenever a stale earlier one survives:
 *   1. a declined/draft shift must never be selected at all, and
 *   2. selection must prefer the shift that is still live, not the earliest.
 */
import { describe, expect, it } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { COVERING_SHIFT_STATUSES } from '@steadily-nanny/shared-types/uncoveredCare';
import { pickCoverShift } from '@/src/domains/today/hooks/useTodayCoverRows';

const CARER = 'carer-h1-nanny1';

function shift(over: Partial<Shift> & Pick<Shift, 'status'>): Shift {
  return {
    id: `shift-${over.status}-${over.starts_at ?? 'x'}`,
    household_id: 'h1',
    carer_id: CARER,
    local_date: '2026-08-10',
    starts_at: '2026-08-10T05:00:00.000Z',
    ends_at: '2026-08-10T19:00:00.000Z',
    kind: 'recurring',
    ...over,
  } as Shift;
}

/**
 * The predicate as it was written before the fix, kept here on purpose: it
 * proves the fixture above actually discriminates. Without this, every
 * assertion below could pass against a function that simply never returns
 * anything, and the pin would be decorative.
 */
function theOldBrokenPick(shifts: Shift[]): Shift | undefined {
  return [...shifts]
    .filter(s => s.status !== 'cancelled')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
}

/** The exact 10 Aug shape, in London time (BST = UTC+1). */
const DECLINED_6_TO_8 = shift({
  status: 'declined',
  starts_at: '2026-08-10T05:00:00.000Z', // 06:00 local
  ends_at: '2026-08-10T19:00:00.000Z', // 20:00 local
});
const CANCELLED_9_TO_5 = shift({
  status: 'cancelled',
  starts_at: '2026-08-10T08:00:00.000Z',
  ends_at: '2026-08-10T16:00:00.000Z',
});
const CANCELLED_1121 = shift({
  status: 'cancelled',
  starts_at: '2026-08-10T10:21:13.000Z',
  ends_at: '2026-08-10T18:21:13.000Z',
});
const CONFIRMED_1122 = shift({
  status: 'confirmed',
  starts_at: '2026-08-10T10:22:10.000Z', // 11:22 local
  ends_at: '2026-08-10T18:22:10.000Z', // 19:22 local
});

const REAL_DAY = [
  DECLINED_6_TO_8,
  CANCELLED_9_TO_5,
  CANCELLED_1121,
  CONFIRMED_1122,
];

/** 09:00 London — after the declined shift "started", before the real one. */
const NINE_AM = Date.parse('2026-08-10T08:00:00.000Z');

describe('the 10 Aug incident never happens again', () => {
  it('SANITY: the old predicate really does pick the declined shift', () => {
    // If this ever stops being true the fixture has drifted and every
    // assertion below is vacuous.
    const wrong = theOldBrokenPick(REAL_DAY);
    expect(wrong?.id).toBe(DECLINED_6_TO_8.id);
    expect(wrong?.status).toBe('declined');
  });

  it('picks the confirmed 11:22 shift, never the declined 06:00 one', () => {
    const picked = pickCoverShift(REAL_DAY, NINE_AM);
    expect(picked?.id).toBe(CONFIRMED_1122.id);
    expect(picked?.status).toBe('confirmed');
  });

  it('never selects a declined shift even when it is the only one left', () => {
    expect(pickCoverShift([DECLINED_6_TO_8], NINE_AM)).toBeUndefined();
  });

  it('never selects a draft shift', () => {
    expect(
      pickCoverShift([shift({ status: 'draft' })], NINE_AM)
    ).toBeUndefined();
  });

  it('is not fooled by ordering — the declined shift starting first must not win', () => {
    // The original bug was `sort(by starts_at)[0]`, so the earliest won. Feed
    // the list in the order that made it lose, to prove order is irrelevant.
    const reversed = [...REAL_DAY].reverse();
    expect(pickCoverShift(reversed, NINE_AM)?.id).toBe(CONFIRMED_1122.id);
  });

  it('prefers the shift still running over an earlier one that already ended', () => {
    const morning = shift({
      status: 'confirmed',
      id: 'morning',
      starts_at: '2026-08-10T05:00:00.000Z',
      ends_at: '2026-08-10T07:00:00.000Z', // ended before 09:00
    });
    expect(pickCoverShift([morning, CONFIRMED_1122], NINE_AM)?.id).toBe(
      CONFIRMED_1122.id
    );
  });

  it('falls back to the last covering shift once the whole day has ended', () => {
    const afterEverything = Date.parse('2026-08-10T23:00:00.000Z');
    expect(pickCoverShift(REAL_DAY, afterEverything)?.id).toBe(
      CONFIRMED_1122.id
    );
  });

  it('never selects a pending shift — an unanswered ask is not cover (D-22)', () => {
    // `pickCoverShift` feeds the parent's "who has the children today" row.
    // A proposal nobody has accepted must not render as "Priya is covering":
    // the gap card owns that window until someone says yes.
    expect(
      pickCoverShift([shift({ status: 'pending' })], NINE_AM)
    ).toBeUndefined();
    // ...and it must not outrank a real one, whatever the order.
    const withPending = [shift({ status: 'pending' }), CONFIRMED_1122];
    expect(pickCoverShift(withPending, NINE_AM)?.id).toBe(CONFIRMED_1122.id);
  });

  it('holds the shared contract the whole fix rests on', () => {
    // If someone widens this constant, every surface silently regresses.
    // `pending` left this list under D-22 — for "is this shift on someone's
    // schedule", the answer is `SCHEDULED_SHIFT_STATUSES`, not this.
    expect([...COVERING_SHIFT_STATUSES].sort()).toEqual([
      'completed',
      'confirmed',
    ]);
  });
});
