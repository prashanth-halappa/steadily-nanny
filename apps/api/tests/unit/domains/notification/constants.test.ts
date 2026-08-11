/**
 * @module tests/unit/domains/notification/constants.test
 */
import { describe, expect, it } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { QUIET_HOURS_EXEMPT_TYPES } from '../../../../src/domains/notification/constants';

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
