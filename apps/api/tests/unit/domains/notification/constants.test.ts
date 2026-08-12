/**
 * @module tests/unit/domains/notification/constants.test
 */
import { describe, expect, it } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import {
  isQuietHoursExempt,
  QUIET_HOURS_EXEMPT_TYPES,
} from '../../../../src/domains/notification/constants';

describe('QUIET_HOURS_EXEMPT_TYPES', () => {
  it('exempts only deadline-bearing types that auto-approve on timeout', () => {
    expect(
      QUIET_HOURS_EXEMPT_TYPES.has(
        PUSH_NOTIFICATION_TYPES.SHIFT_NEEDS_RECONFIRM
      )
    ).toBe(true);
    expect(
      QUIET_HOURS_EXEMPT_TYPES.has(
        PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED
      )
    ).toBe(true);
    expect(
      QUIET_HOURS_EXEMPT_TYPES.has(PUSH_NOTIFICATION_TYPES.EXTRA_SHIFT_PROPOSED)
    ).toBe(false);
  });

  // D-28 (A4): a child-safety-adjacent fact — "nobody has clocked in" —
  // breaks through quiet hours. The morning catch-up digest is deliberately
  // NOT in this set (§1.5/A12: it is the definition of non-urgent).
  it('exempts shift_no_show (D-28) and nothing else new', () => {
    expect(
      QUIET_HOURS_EXEMPT_TYPES.has(PUSH_NOTIFICATION_TYPES.SHIFT_NO_SHOW)
    ).toBe(true);
    expect(
      QUIET_HOURS_EXEMPT_TYPES.has(PUSH_NOTIFICATION_TYPES.SHIFT_NO_SHOW_DIGEST)
    ).toBe(false);
    expect(
      QUIET_HOURS_EXEMPT_TYPES.has(PUSH_NOTIFICATION_TYPES.COVER_ASK_REMINDER)
    ).toBe(false);
    expect(QUIET_HOURS_EXEMPT_TYPES.size).toBe(3);
  });
});

/**
 * D-47 (§1.3 ‡) — the product's first CONDITIONAL exemption. An ask that dies
 * at 21:30 for an 07:00 shift is a child with nobody booked in nine hours;
 * deferring it to 07:00 hands the parent the news at the moment it stops being
 * fixable. An ask expiring four days out defers like everything else.
 */
describe('isQuietHoursExempt — cover_ask_expired inside 12h (D-47)', () => {
  const NOW = new Date();
  const SHIFT_IN_9_5H = new Date(
    NOW.getTime() + 9.5 * 60 * 60 * 1000
  ).toISOString();
  const SHIFT_IN_4_DAYS = new Date(
    NOW.getTime() + 4 * 24 * 60 * 60 * 1000
  ).toISOString();
  const SHIFT_IN_12H = new Date(
    NOW.getTime() + 12 * 60 * 60 * 1000
  ).toISOString();
  const expiredPush = (shiftStartsAt?: unknown) => ({
    type: PUSH_NOTIFICATION_TYPES.COVER_ASK_EXPIRED,
    ...(shiftStartsAt === undefined ? {} : { shiftStartsAt }),
  });

  it('breaks through when the shift starts in 9.5 hours', () => {
    expect(isQuietHoursExempt(expiredPush(SHIFT_IN_9_5H), NOW)).toBe(true);
  });

  it('defers like everything else when the shift is four days out', () => {
    expect(isQuietHoursExempt(expiredPush(SHIFT_IN_4_DAYS), NOW)).toBe(false);
  });

  it('is exclusive at exactly 12h', () => {
    expect(isQuietHoursExempt(expiredPush(SHIFT_IN_12H), NOW)).toBe(false);
  });

  it('CANNOT be self-granted: no shiftStartsAt means no exemption', () => {
    // The condition reads a FACT about the shift off the payload. If this ever
    // becomes a boolean the emitter sets, quiet hours stop working — any push
    // could declare itself urgent.
    expect(isQuietHoursExempt(expiredPush(), NOW)).toBe(false);
    expect(isQuietHoursExempt(expiredPush(true), NOW)).toBe(false);
    expect(isQuietHoursExempt(expiredPush('not a date'), NOW)).toBe(false);
  });

  it('leaves the unconditional D-28 list and everything else alone', () => {
    expect(
      isQuietHoursExempt({ type: PUSH_NOTIFICATION_TYPES.SHIFT_NO_SHOW }, NOW)
    ).toBe(true);
    // A sibling 3-T3 type with a shift start on it must NOT inherit the arm.
    expect(
      isQuietHoursExempt(
        {
          type: PUSH_NOTIFICATION_TYPES.COVER_ASK_DECLINED,
          shiftStartsAt: SHIFT_IN_9_5H,
        },
        NOW
      )
    ).toBe(false);
    expect(isQuietHoursExempt(undefined, NOW)).toBe(false);
  });
});
