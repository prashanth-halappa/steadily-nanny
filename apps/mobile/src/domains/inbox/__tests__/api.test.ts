/**
 * @module domains/inbox/__tests__/api.test
 *
 * Inbox-local client: PATCH /households/:householdId/approvals/:approvalId
 * body-validated against the shared RespondToCoParentApprovalSchema, response
 * unwrapped + validated like listPendingApprovals.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const APPROVAL_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const REQUESTED_BY = '33333333-3333-4333-8333-333333333333';
const RESPONDED_BY = '44444444-4444-4444-8444-444444444444';

const approvalFixture = (status: 'approved' | 'declined') => ({
  id: APPROVAL_ID,
  household_id: HOUSEHOLD_ID,
  requested_by: REQUESTED_BY,
  action: 'extra_shift',
  payload: { shift_id: 'shift-1' },
  status,
  timeout_at: '2026-08-04T12:00:00Z',
  responded_by: RESPONDED_BY,
  responded_at: '2026-08-01T10:00:00Z',
  created_at: '2026-08-01T09:00:00Z',
  updated_at: '2026-08-01T10:00:00Z',
});

const getMock = mock(() =>
  Promise.resolve({ data: { data: { co_parent_approvals: [] } } })
);
const patchMock = mock(
  (): Promise<{ data: { data: unknown } }> =>
    Promise.resolve({
      data: { data: { approval: approvalFixture('approved') } },
    })
);

mock.module('@/src/api/client', () => ({
  apiClient: { get: getMock, patch: patchMock },
}));

describe('inbox api — respondToApproval', () => {
  beforeEach(() => {
    getMock.mockClear();
    patchMock.mockClear();
  });

  it('PATCHes the household approval endpoint with the status body', async () => {
    const { respondToApproval } = await import('../api');

    const approval = await respondToApproval(
      HOUSEHOLD_ID,
      APPROVAL_ID,
      'approved'
    );

    expect(patchMock).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/approvals/${APPROVAL_ID}`,
      { status: 'approved' }
    );
    expect(approval.status).toBe('approved');
    expect(approval.id).toBe(APPROVAL_ID);
  });

  it('supports declined status', async () => {
    patchMock.mockImplementationOnce(() =>
      Promise.resolve({
        data: { data: { approval: approvalFixture('declined') } },
      })
    );

    const { respondToApproval } = await import('../api');
    const approval = await respondToApproval(
      HOUSEHOLD_ID,
      APPROVAL_ID,
      'declined'
    );

    expect(patchMock).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/approvals/${APPROVAL_ID}`,
      { status: 'declined' }
    );
    expect(approval.status).toBe('declined');
  });

  it('throws when the response payload fails validation', async () => {
    patchMock.mockImplementationOnce(() =>
      Promise.resolve({ data: { data: { approval: { status: 'approved' } } } })
    );

    const { respondToApproval } = await import('../api');
    await expect(
      respondToApproval(HOUSEHOLD_ID, APPROVAL_ID, 'approved')
    ).rejects.toThrow();
  });
});
