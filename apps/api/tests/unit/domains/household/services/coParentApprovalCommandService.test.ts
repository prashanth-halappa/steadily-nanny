import { beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  ApprovalNotFoundError,
  ApprovalNotPendingError,
  SelfApprovalNotAllowedError,
} from '../../../../../src/domains/household/errors/approvalErrors';
import { NotAHouseholdParentError } from '../../../../../src/domains/household/errors/householdErrors';
import { approvalApplierRegistry } from '../../../../../src/domains/household/services/approvalApplierRegistry';
import { CoParentApprovalCommandService } from '../../../../../src/domains/household/services/coParentApprovalCommandService';
import type { HouseholdMember } from '../../../../../src/domains/household/types';

function membershipFor(role: HouseholdMember['role']): HouseholdMember {
  return {
    id: 'm1',
    household_id: 'h1',
    user_id: 'u1',
    role,
    can_edit: role === 'owner',
    status: 'active',
    display_name_override: null,
    colour: null,
    joined_at: 't',
    created_at: 't',
    updated_at: 't',
  };
}

function pendingApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    household_id: 'h1',
    requested_by: 'u2',
    action: 'cancel',
    payload: {},
    status: 'pending',
    timeout_at: '2999-01-01T00:00:00Z',
    responded_by: null,
    responded_at: null,
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

function makeApprovalRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...pendingApproval(),
      ...data,
      id: 'a-new',
    })),
    findById: mock(async () => pendingApproval()),
    respond: mock(async (id: string, status: string, respondedBy: string) => ({
      ...pendingApproval(),
      id,
      status,
      responded_by: respondedBy,
      responded_at: 't',
    })),
    recordFailedApply: mock(async () => 'retrying'),
    clearApplyMarkers: mock(async () => {}),
    ...overrides,
  };
}

function makeHouseholds(
  role: HouseholdMember['role'] = 'owner',
  overrides: Record<string, unknown> = {}
): any {
  return {
    getMembership: mock(async () => membershipFor(role)),
    ...overrides,
  };
}

// An approve with no registered applier is a failure now, not a silent
// success, so every test that approves needs one. Tests that want a different
// applier register it in their own body, which runs after this.
beforeEach(() => {
  approvalApplierRegistry.register('cancel', async () => {});
});

describe('CoParentApprovalCommandService.create', () => {
  it('opens a pending approval with a timeout_at derived from timeoutMinutes', async () => {
    const approvalRepo = makeApprovalRepo();
    const svc = new CoParentApprovalCommandService(
      approvalRepo,
      makeHouseholds()
    );
    const before = Date.now();
    const approval = await svc.create(
      'h1',
      'u1',
      'extra_shift',
      { shift_id: 's1' },
      45
    );
    expect(approvalRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'h1',
        requested_by: 'u1',
        action: 'extra_shift',
        payload: { shift_id: 's1' },
        status: 'pending',
      })
    );
    expect(approval.id).toBe('a-new');
    const timeoutAt = new Date(approval.timeout_at).getTime();
    expect(timeoutAt).toBeGreaterThanOrEqual(before + 45 * 60_000 - 2000);
  });
});

describe('CoParentApprovalCommandService.respond', () => {
  it('lets a parent approve a pending approval belonging to the household', async () => {
    const approvalRepo = makeApprovalRepo();
    const svc = new CoParentApprovalCommandService(
      approvalRepo,
      makeHouseholds('parent')
    );
    const result = await svc.respond('u1', 'h1', 'a1', { status: 'approved' });
    expect(approvalRepo.respond).toHaveBeenCalledWith('a1', 'approved', 'u1');
    expect(result.status).toBe('approved');
  });

  it('lets the owner decline', async () => {
    const approvalRepo = makeApprovalRepo();
    const svc = new CoParentApprovalCommandService(
      approvalRepo,
      makeHouseholds('owner')
    );
    await svc.respond('u1', 'h1', 'a1', { status: 'declined' });
    expect(approvalRepo.respond).toHaveBeenCalledWith('a1', 'declined', 'u1');
  });

  it('rejects a nanny with NotAHouseholdParentError', async () => {
    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo(),
      makeHouseholds('nanny')
    );
    await expect(
      svc.respond('u1', 'h1', 'a1', { status: 'approved' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  it('throws ApprovalNotFoundError when the approval does not exist', async () => {
    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo({ findById: mock(async () => null) }),
      makeHouseholds()
    );
    await expect(
      svc.respond('u1', 'h1', 'missing', { status: 'approved' })
    ).rejects.toBeInstanceOf(ApprovalNotFoundError);
  });

  it('throws the SAME ApprovalNotFoundError when the approval belongs to a different household', async () => {
    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo({
        findById: mock(async () => pendingApproval({ household_id: 'h2' })),
      }),
      makeHouseholds()
    );
    await expect(
      svc.respond('u1', 'h1', 'a1', { status: 'approved' })
    ).rejects.toBeInstanceOf(ApprovalNotFoundError);
  });

  it('throws ApprovalNotPendingError when already responded to', async () => {
    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo({
        findById: mock(async () => pendingApproval({ status: 'approved' })),
      }),
      makeHouseholds()
    );
    await expect(
      svc.respond('u1', 'h1', 'a1', { status: 'declined' })
    ).rejects.toBeInstanceOf(ApprovalNotPendingError);
  });

  it('throws ApprovalNotPendingError when already timed out', async () => {
    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo({
        findById: mock(async () => pendingApproval({ status: 'timed_out' })),
      }),
      makeHouseholds()
    );
    await expect(
      svc.respond('u1', 'h1', 'a1', { status: 'approved' })
    ).rejects.toBeInstanceOf(ApprovalNotPendingError);
  });

  it('refuses to let the requesting parent approve their own request', async () => {
    // The whole point of approval_mode='ask_other' is that the OTHER parent
    // signs off. Without this the gate is decorative: the requester could
    // open and immediately approve their own short-notice cancellation.
    const approvalRepo = makeApprovalRepo({
      findById: mock(async () => pendingApproval({ requested_by: 'u1' })),
    });
    const svc = new CoParentApprovalCommandService(
      approvalRepo,
      makeHouseholds('parent')
    );

    await expect(
      svc.respond('u1', 'h1', 'a1', { status: 'approved' })
    ).rejects.toBeInstanceOf(SelfApprovalNotAllowedError);
    expect(approvalRepo.respond).not.toHaveBeenCalled();
  });

  it('refuses self-response for a decline too, not just an approve', async () => {
    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo({
        findById: mock(async () => pendingApproval({ requested_by: 'u1' })),
      }),
      makeHouseholds('owner')
    );
    await expect(
      svc.respond('u1', 'h1', 'a1', { status: 'declined' })
    ).rejects.toBeInstanceOf(SelfApprovalNotAllowedError);
  });
});

describe('CoParentApprovalCommandService.respond — applying the gated mutation', () => {
  it('re-drives the gated mutation through the applier registry on approve', async () => {
    // Regression: approving used to flip `status` and stop there, so the
    // change the approval was gating never happened at all.
    const applied: unknown[] = [];
    const applier = mock(async (approval: unknown) => {
      applied.push(approval);
    });
    approvalApplierRegistry.register('cancel', applier);

    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo(),
      makeHouseholds('parent')
    );
    await svc.respond('u1', 'h1', 'a1', { status: 'approved' });

    expect(applier).toHaveBeenCalledTimes(1);
    expect(applied[0]).toMatchObject({
      id: 'a1',
      action: 'cancel',
      status: 'approved',
    });
  });

  it('does NOT apply anything when the co-parent declines', async () => {
    const applier = mock(async () => {});
    approvalApplierRegistry.register('cancel', applier);

    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo(),
      makeHouseholds('parent')
    );
    await svc.respond('u1', 'h1', 'a1', { status: 'declined' });

    expect(applier).not.toHaveBeenCalled();
  });

  it('surfaces an applier failure rather than reporting a silent success', async () => {
    // A swallowed failure here is indistinguishable to the approving parent
    // from the change having been applied.
    approvalApplierRegistry.register('cancel', async () => {
      throw new Error('shift is gone');
    });

    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo(),
      makeHouseholds('parent')
    );
    await expect(
      svc.respond('u1', 'h1', 'a1', { status: 'approved' })
    ).rejects.toThrow('shift is gone');
  });

  it('records the failed apply against the claimed row instead of leaving it settled', async () => {
    // `respond` commits `approved` in its own CAS statement before the applier
    // runs. Without this the row is stuck terminally approved with nothing
    // applied, and a retry is impossible because the second respond fails the
    // `status = pending` CAS.
    approvalApplierRegistry.register('cancel', async () => {
      throw new Error('shift is gone');
    });
    const approvalRepo = makeApprovalRepo();

    const svc = new CoParentApprovalCommandService(
      approvalRepo,
      makeHouseholds('parent')
    );
    await expect(
      svc.respond('u1', 'h1', 'a1', { status: 'approved' })
    ).rejects.toThrow('shift is gone');

    expect(approvalRepo.recordFailedApply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1' }),
      'approved',
      'shift is gone',
      // A real applier failure MAY have half-written, so it spends an attempt.
      true
    );
  });

  it('still surfaces the applier error when recording the failure itself fails', async () => {
    approvalApplierRegistry.register('cancel', async () => {
      throw new Error('shift is gone');
    });
    const approvalRepo = makeApprovalRepo({
      recordFailedApply: mock(async () => {
        throw new Error('database unreachable');
      }),
    });

    const svc = new CoParentApprovalCommandService(
      approvalRepo,
      makeHouseholds('parent')
    );
    await expect(
      svc.respond('u1', 'h1', 'a1', { status: 'approved' })
    ).rejects.toThrow('shift is gone');
  });

  it('records nothing when the applier succeeds — the uncontested path costs nothing', async () => {
    approvalApplierRegistry.register('cancel', async () => {});
    const approvalRepo = makeApprovalRepo();

    const svc = new CoParentApprovalCommandService(
      approvalRepo,
      makeHouseholds('parent')
    );
    const result = await svc.respond('u1', 'h1', 'a1', { status: 'approved' });

    expect(approvalRepo.recordFailedApply).not.toHaveBeenCalled();
    expect(result.status).toBe('approved');
  });

  it('records nothing on a decline', async () => {
    approvalApplierRegistry.register('cancel', async () => {
      throw new Error('shift is gone');
    });
    const approvalRepo = makeApprovalRepo();

    const svc = new CoParentApprovalCommandService(
      approvalRepo,
      makeHouseholds('parent')
    );
    await svc.respond('u1', 'h1', 'a1', { status: 'declined' });

    expect(approvalRepo.recordFailedApply).not.toHaveBeenCalled();
  });

  it('treats an action with NO registered applier as a failure, not a silent success', async () => {
    // The original flow-1f defect: an approval that settles `approved` and
    // then does nothing at all. `other` has no applier registered by anyone.
    const approvalRepo = makeApprovalRepo({
      findById: mock(async () => pendingApproval({ action: 'other' })),
      respond: mock(async (id: string, status: string) => ({
        ...pendingApproval({ action: 'other' }),
        id,
        status,
      })),
    });

    const svc = new CoParentApprovalCommandService(
      approvalRepo,
      makeHouseholds('parent')
    );
    await expect(
      svc.respond('u1', 'h1', 'a1', { status: 'approved' })
    ).rejects.toThrow();

    expect(approvalRepo.recordFailedApply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1' }),
      'approved',
      expect.any(String),
      // A missing applier costs no attempt: it wrote nothing, and burning
      // attempts would withdraw the mutation for good over a deploy bug.
      false
    );
  });

  it('clears stale apply markers when the applier finally succeeds', async () => {
    approvalApplierRegistry.register('cancel', async () => {});
    const approvalRepo = makeApprovalRepo();

    const svc = new CoParentApprovalCommandService(
      approvalRepo,
      makeHouseholds('parent')
    );
    await svc.respond('u1', 'h1', 'a1', { status: 'approved' });

    expect(approvalRepo.clearApplyMarkers).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1' })
    );
  });
});
