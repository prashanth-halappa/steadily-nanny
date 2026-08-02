import { describe, expect, it } from 'bun:test';
import {
  CO_PARENT_APPROVAL_ACTIONS,
  CO_PARENT_APPROVAL_STATUSES,
  CoParentApprovalSchema,
  RespondToCoParentApprovalSchema,
} from '../src/schemas/approval.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-08-01T10:00:00Z';

describe('approval.schema', () => {
  it('actions match SQL check', () => {
    const values: string[] = Object.values(CO_PARENT_APPROVAL_ACTIONS);
    expect(values.sort()).toEqual(
      ['short_notice_change', 'cancel', 'extra_shift', 'other'].sort()
    );
  });

  it('statuses match SQL check', () => {
    const values: string[] = Object.values(CO_PARENT_APPROVAL_STATUSES);
    expect(values.sort()).toEqual(
      ['pending', 'approved', 'declined', 'timed_out', 'withdrawn'].sort()
    );
  });

  it('parses a valid pending approval', () => {
    expect(
      CoParentApprovalSchema.safeParse({
        id: VALID_UUID,
        household_id: VALID_UUID,
        requested_by: VALID_UUID,
        action: 'cancel',
        payload: { shift_id: VALID_UUID },
        status: 'pending',
        timeout_at: NOW,
        responded_by: null,
        responded_at: null,
        created_at: NOW,
        updated_at: NOW,
      }).success
    ).toBe(true);
  });

  it('respond accepts approved/declined only', () => {
    expect(
      RespondToCoParentApprovalSchema.safeParse({ status: 'approved' }).success
    ).toBe(true);
    expect(
      RespondToCoParentApprovalSchema.safeParse({ status: 'timed_out' }).success
    ).toBe(false);
  });
});
