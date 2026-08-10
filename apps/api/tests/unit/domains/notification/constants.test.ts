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
});
