/**
 * Co-parent approval request/resolved pushes.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { approvalApplierRegistry } from '../../../../../src/domains/household/services/approvalApplierRegistry';
import type { HouseholdMember } from '../../../../../src/domains/household/types';

let CoParentApprovalCommandService: typeof import('../../../../../src/domains/household/services/coParentApprovalCommandService').CoParentApprovalCommandService;
let notifyUser: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyUser = mock(() => undefined);
  mock.module('../../../../../src/domains/notification', () => ({
    notifyUser,
    notifyHouseholdParents: mock(() => undefined),
  }));

  ({ CoParentApprovalCommandService } = await import(
    '../../../../../src/domains/household/services/coParentApprovalCommandService'
  ));
});

beforeEach(() => {
  notifyUser.mockClear();
});

function membership(
  role: HouseholdMember['role'],
  userId: string
): HouseholdMember {
  return {
    id: `m-${userId}`,
    household_id: 'h1',
    user_id: userId,
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
    requested_by: 'parent-1',
    action: 'cancel',
    payload: {},
    status: 'pending',
    timeout_at: '2999-06-15T14:30:00.000Z',
    responded_by: null,
    responded_at: null,
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

function makeApprovalRepo(overrides: Record<string, unknown> = {}) {
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
    recordFailedApply: mock(async () => 'retrying' as const),
    clearApplyMarkers: mock(async () => {}),
    ...overrides,
  };
}

function makeHouseholds(role: HouseholdMember['role'] = 'parent') {
  return {
    getMembership: mock(async () => membership(role, 'parent-2')),
  };
}

describe('CoParentApprovalCommandService.create — co_parent_approval_requested', () => {
  it('notifies the other parent, not the requester', async () => {
    const memberRepo = {
      listActiveByHousehold: mock(async () => [
        membership('parent', 'parent-1'),
        membership('parent', 'parent-2'),
      ]),
    };
    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo() as never,
      makeHouseholds() as never,
      memberRepo as never
    );

    await svc.create('h1', 'parent-1', 'cancel', {}, 60);

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      'parent-2',
      expect.objectContaining({
        body: expect.stringMatching(/shift cancellation.*Respond by/i),
        data: {
          type: PUSH_NOTIFICATION_TYPES.CO_PARENT_APPROVAL_REQUESTED,
          householdId: 'h1',
        },
      })
    );
  });

  it('push failure does not fail create', async () => {
    notifyUser.mockImplementation(() => {
      throw new Error('expo down');
    });
    const memberRepo = {
      listActiveByHousehold: mock(async () => [
        membership('parent', 'parent-1'),
        membership('owner', 'parent-2'),
      ]),
    };
    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo() as never,
      makeHouseholds() as never,
      memberRepo as never
    );

    await expect(
      svc.create('h1', 'parent-1', 'extra_shift', {}, 30)
    ).resolves.toMatchObject({ id: 'a-new' });
  });
});

describe('CoParentApprovalCommandService.respond — co_parent_approval_resolved', () => {
  it('notifies the requester on approval', async () => {
    approvalApplierRegistry.register('cancel', async () => undefined);
    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo() as never,
      makeHouseholds('parent') as never,
      { listActiveByHousehold: mock(async () => []) } as never
    );

    await svc.respond('parent-2', 'h1', 'a1', { status: 'approved' });

    expect(notifyUser).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({
        title: 'Request approved',
        body: expect.stringContaining('approved'),
        data: {
          type: PUSH_NOTIFICATION_TYPES.CO_PARENT_APPROVAL_RESOLVED,
          householdId: 'h1',
        },
      })
    );
  });

  it('notifies the requester on decline', async () => {
    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo() as never,
      makeHouseholds('parent') as never,
      { listActiveByHousehold: mock(async () => []) } as never
    );

    await svc.respond('parent-2', 'h1', 'a1', { status: 'declined' });

    expect(notifyUser).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({
        title: 'Request declined',
        body: expect.stringContaining('declined'),
        data: {
          type: PUSH_NOTIFICATION_TYPES.CO_PARENT_APPROVAL_RESOLVED,
          householdId: 'h1',
        },
      })
    );
  });
});

describe('CoParentApprovalCommandService.respond — D3 terminal apply-failure push', () => {
  it('notifies the requester once the respond-path apply is exhausted (terminal `failed`)', async () => {
    approvalApplierRegistry.register('cancel', async () => {
      throw new Error('shift already started');
    });
    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo({
        recordFailedApply: mock(async () => 'failed' as const),
      }) as never,
      makeHouseholds('parent') as never,
      { listActiveByHousehold: mock(async () => []) } as never
    );

    await expect(
      svc.respond('parent-2', 'h1', 'a1', { status: 'approved' })
    ).rejects.toThrow();

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({
        body: expect.stringMatching(/couldn.t be completed/i),
      })
    );
  });

  it('does NOT notify the requester on a first, still-retrying failure', async () => {
    approvalApplierRegistry.register('cancel', async () => {
      throw new Error('shift already started');
    });
    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo({
        recordFailedApply: mock(async () => 'retrying' as const),
      }) as never,
      makeHouseholds('parent') as never,
      { listActiveByHousehold: mock(async () => []) } as never
    );

    await expect(
      svc.respond('parent-2', 'h1', 'a1', { status: 'approved' })
    ).rejects.toThrow();

    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('does NOT send a terminal-failure push when the applier succeeds', async () => {
    approvalApplierRegistry.register('cancel', async () => undefined);
    const svc = new CoParentApprovalCommandService(
      makeApprovalRepo() as never,
      makeHouseholds('parent') as never,
      { listActiveByHousehold: mock(async () => []) } as never
    );

    await svc.respond('parent-2', 'h1', 'a1', { status: 'approved' });

    for (const call of notifyUser.mock.calls) {
      expect(call[1]).not.toMatchObject({
        body: expect.stringMatching(/couldn.t be completed/i),
      });
    }
  });
});
