/**
 * `UnsettledReimbursementWeekSchema` has to survive the carer deleting her
 * account (033/058). The mobile endpoint layer `safeParse`s this list and
 * THROWS on the first bad row, blanking the whole Today inbox — so a
 * non-nullable `carer_id` here turns a departed carer's outstanding
 * reimbursement into a blank screen for everyone in the household.
 */
import { describe, expect, it } from 'bun:test';
import {
  UnsettledReimbursementListResponseSchema,
  UnsettledReimbursementWeekSchema,
} from '../src/schemas/reimbursementSettlement.schema';

const CARER_UUID = '11111111-1111-4111-8111-111111111111';
/** A `household_members.id` — deliberately different from the carer's id. */
const MEMBER_UUID = '22222222-2222-4222-8222-222222222222';

const liveWeek = {
  carer_id: CARER_UUID,
  household_member_id: MEMBER_UUID,
  carer_display_name: 'Marisol Reyes',
  week_start: '2026-08-03',
  amount_minor: 1250,
  currency: 'GBP',
};

describe('UnsettledReimbursementWeekSchema', () => {
  it('parses a live carer’s week', () => {
    expect(UnsettledReimbursementWeekSchema.safeParse(liveWeek).success).toBe(
      true
    );
  });

  it('parses a DEPARTED carer’s week — null carer_id, name and stamp intact', () => {
    const parsed = UnsettledReimbursementWeekSchema.safeParse({
      ...liveWeek,
      carer_id: null,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.household_member_id).toBe(MEMBER_UUID);
    expect(parsed.data?.carer_display_name).toBe('Marisol Reyes');
  });

  it('accepts a pre-058 row with no membership stamp at all', () => {
    const { household_member_id: _omitted, ...noStamp } = liveWeek;
    expect(
      UnsettledReimbursementWeekSchema.safeParse({
        ...noStamp,
        carer_id: null,
        household_member_id: null,
      }).success
    ).toBe(true);
  });

  it('still refuses a garbage carer_id — nullable is not "anything"', () => {
    expect(
      UnsettledReimbursementWeekSchema.safeParse({
        ...liveWeek,
        carer_id: 'not-a-uuid',
      }).success
    ).toBe(false);
  });

  it('still refuses a zero amount — a week with nothing owed is simply absent', () => {
    expect(
      UnsettledReimbursementWeekSchema.safeParse({
        ...liveWeek,
        amount_minor: 0,
      }).success
    ).toBe(false);
  });

  it('carries a mixed live/departed list through the response envelope', () => {
    const parsed = UnsettledReimbursementListResponseSchema.safeParse({
      weeks: [liveWeek, { ...liveWeek, carer_id: null }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.weeks).toHaveLength(2);
  });
});
