import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { NotAHouseholdParentError } from '../../../../../src/domains/household/errors/householdErrors';
import type {
  CoParentApproval,
  HouseholdMember,
} from '../../../../../src/domains/household/types';

/**
 * The registry's own compensating revert (a timed-out row whose applier threw
 * goes back to `pending` so the next sweep retries it) default-constructs a
 * `CoParentApprovalRepository`. That must never become a real Supabase call
 * from a unit test, so the repository module is mocked before the query
 * service — and with it the registry — is imported.
 */
const recordFailedApply = mock(async () => 'retrying' as const);

let CoParentApprovalQueryService: any;
let approvalApplierRegistry: any;

beforeAll(async () => {
  mock.module(
    '../../../../../src/domains/household/repositories/coParentApprovalRepository',
    () => ({
      CoParentApprovalRepository: class {
        recordFailedApply = recordFailedApply;
      },
    })
  );

  ({ CoParentApprovalQueryService } = await import(
    '../../../../../src/domains/household/services/coParentApprovalQueryService'
  ));
  ({ approvalApplierRegistry } = await import(
    '../../../../../src/domains/household/services/approvalApplierRegistry'
  ));
});

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

function approvalFor(
  overrides: Partial<CoParentApproval> = {}
): CoParentApproval {
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
    listPendingByHousehold: mock(async () => [approvalFor()]),
    expireTimedOut: mock(async () => []),
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

describe('CoParentApprovalQueryService.listPending', () => {
  it('expires stale rows then returns the pending list, for a parent caller', async () => {
    const approvalRepo = makeApprovalRepo();
    const svc = new CoParentApprovalQueryService(
      approvalRepo,
      makeHouseholds('parent')
    );
    const result = await svc.listPending('u1', 'h1');
    expect(approvalRepo.expireTimedOut).toHaveBeenCalled();
    expect(approvalRepo.listPendingByHousehold).toHaveBeenCalledWith('h1');
    expect(result).toEqual([approvalFor()]);
  });

  it('allows the owner too', async () => {
    const svc = new CoParentApprovalQueryService(
      makeApprovalRepo(),
      makeHouseholds('owner')
    );
    await expect(svc.listPending('u1', 'h1')).resolves.toBeDefined();
  });

  it('rejects a nanny with NotAHouseholdParentError', async () => {
    const svc = new CoParentApprovalQueryService(
      makeApprovalRepo(),
      makeHouseholds('nanny')
    );
    await expect(svc.listPending('u1', 'h1')).rejects.toBeInstanceOf(
      NotAHouseholdParentError
    );
  });

  it('rejects a helper with NotAHouseholdParentError', async () => {
    const svc = new CoParentApprovalQueryService(
      makeApprovalRepo(),
      makeHouseholds('helper')
    );
    await expect(svc.listPending('u1', 'h1')).rejects.toBeInstanceOf(
      NotAHouseholdParentError
    );
  });
});

describe('CoParentApprovalQueryService.expirePendingApprovals — auto-approve by silence', () => {
  it('re-drives each expired row through the applier registry', async () => {
    // Timing out means auto-APPROVE by silence (022_co_parent_approvals.sql):
    // a silent phone must not leave a day uncovered, so the gated mutation
    // still has to happen.
    const applied: string[] = [];
    approvalApplierRegistry.register(
      'cancel',
      async (approval: CoParentApproval) => {
        applied.push(approval.id);
      }
    );
    const timedOut = [
      approvalFor({ id: 'a1', status: 'timed_out' }),
      approvalFor({ id: 'a2', status: 'timed_out' }),
    ];
    const svc = new CoParentApprovalQueryService(
      makeApprovalRepo({ expireTimedOut: mock(async () => timedOut) }),
      makeHouseholds()
    );

    await svc.expirePendingApprovals();

    expect(applied).toEqual(['a1', 'a2']);
  });

  it('steps over a row whose applier throws, records the failure, and still applies the rest', async () => {
    // One unappliable row must never strand a whole sweep — but the sweep has
    // already committed `timed_out` on it, so stepping over it also has to
    // record the failed apply, or it settles terminally with nothing applied.
    recordFailedApply.mockClear();
    const applied: string[] = [];
    approvalApplierRegistry.register(
      'cancel',
      async (approval: CoParentApproval) => {
        if (approval.id === 'a-bad') {
          throw new Error('shift is gone');
        }
        applied.push(approval.id);
      }
    );
    const timedOut = [
      approvalFor({ id: 'a-bad', status: 'timed_out' }),
      approvalFor({ id: 'a-good', status: 'timed_out' }),
    ];
    const svc = new CoParentApprovalQueryService(
      makeApprovalRepo({ expireTimedOut: mock(async () => timedOut) }),
      makeHouseholds()
    );

    const result = await svc.expirePendingApprovals();

    expect(applied).toEqual(['a-good']);
    expect(result).toEqual(timedOut);
    expect(recordFailedApply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a-bad' }),
      'timed_out',
      'shift is gone',
      true
    );
  });
});

describe('CoParentApprovalQueryService.expirePendingApprovals', () => {
  it('times out past-due pending rows and returns them', async () => {
    const timedOut = [approvalFor({ status: 'timed_out' })];
    const approvalRepo = makeApprovalRepo({
      expireTimedOut: mock(async () => timedOut),
    });
    const svc = new CoParentApprovalQueryService(
      approvalRepo,
      makeHouseholds()
    );
    const result = await svc.expirePendingApprovals('h1');
    expect(approvalRepo.expireTimedOut).toHaveBeenCalledWith(
      expect.any(String),
      'h1'
    );
    expect(result).toEqual(timedOut);
  });

  it('runs globally (no householdId) for the maintenance job', async () => {
    const approvalRepo = makeApprovalRepo();
    const svc = new CoParentApprovalQueryService(
      approvalRepo,
      makeHouseholds()
    );
    await svc.expirePendingApprovals();
    expect(approvalRepo.expireTimedOut).toHaveBeenCalledWith(
      expect.any(String),
      undefined
    );
  });

  it('returns [] when nothing is past due', async () => {
    const svc = new CoParentApprovalQueryService(
      makeApprovalRepo({ expireTimedOut: mock(async () => []) }),
      makeHouseholds()
    );
    expect(await svc.expirePendingApprovals('h1')).toEqual([]);
  });
});
