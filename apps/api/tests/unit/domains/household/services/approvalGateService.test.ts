import { describe, expect, it, mock } from 'bun:test';
import { NotHouseholdOwnerError } from '../../../../../src/domains/household/errors/approvalErrors';
import { NotAHouseholdParentError } from '../../../../../src/domains/household/errors/householdErrors';
import { ApprovalGateService } from '../../../../../src/domains/household/services/approvalGateService';
import type {
  Household,
  HouseholdMember,
} from '../../../../../src/domains/household/types';

function makeHousehold(overrides: Partial<Household> = {}): Household {
  return {
    id: 'h1',
    name: 'The Smiths',
    timezone: 'Europe/London',
    address_line: null,
    latitude: null,
    longitude: null,
    approval_mode: 'either',
    approval_scope: 'short_notice_and_cancellations',
    approval_timeout_minutes: 120,
    short_notice_hours: 24,
    cancellation_paid_within_hours: 24,
    created_by: 'u1',
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

function makeMembership(
  role: HouseholdMember['role'],
  overrides: Partial<HouseholdMember> = {}
): HouseholdMember {
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
    ...overrides,
  };
}

function makeApprovalRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      id: 'a-new',
      responded_by: null,
      responded_at: null,
      created_at: 't',
      updated_at: 't',
      ...data,
    })),
    ...overrides,
  };
}

describe('ApprovalGateService.assertApprovalAllows — either', () => {
  it('allows an owner to proceed without creating an approval', async () => {
    const approvalRepo = makeApprovalRepo();
    const gate = new ApprovalGateService(approvalRepo);
    const result = await gate.assertApprovalAllows(
      makeHousehold({ approval_mode: 'either' }),
      makeMembership('owner'),
      'cancel'
    );
    expect(result).toEqual({ needsApproval: false });
    expect(approvalRepo.create).not.toHaveBeenCalled();
  });

  it('allows a parent to proceed without creating an approval', async () => {
    const approvalRepo = makeApprovalRepo();
    const gate = new ApprovalGateService(approvalRepo);
    const result = await gate.assertApprovalAllows(
      makeHousehold({ approval_mode: 'either' }),
      makeMembership('parent'),
      'short_notice_change'
    );
    expect(result).toEqual({ needsApproval: false });
    expect(approvalRepo.create).not.toHaveBeenCalled();
  });

  it('rejects a nanny with NotAHouseholdParentError', async () => {
    const gate = new ApprovalGateService(makeApprovalRepo());
    await expect(
      gate.assertApprovalAllows(
        makeHousehold({ approval_mode: 'either' }),
        makeMembership('nanny'),
        'cancel'
      )
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });
});

describe('ApprovalGateService.assertApprovalAllows — owner_only', () => {
  it('allows the owner to proceed', async () => {
    const approvalRepo = makeApprovalRepo();
    const gate = new ApprovalGateService(approvalRepo);
    const result = await gate.assertApprovalAllows(
      makeHousehold({ approval_mode: 'owner_only' }),
      makeMembership('owner'),
      'cancel'
    );
    expect(result).toEqual({ needsApproval: false });
  });

  it('rejects a parent (non-owner) with NotHouseholdOwnerError', async () => {
    const gate = new ApprovalGateService(makeApprovalRepo());
    await expect(
      gate.assertApprovalAllows(
        makeHousehold({ approval_mode: 'owner_only' }),
        makeMembership('parent'),
        'cancel'
      )
    ).rejects.toBeInstanceOf(NotHouseholdOwnerError);
  });

  it('rejects a nanny with NotHouseholdOwnerError', async () => {
    const gate = new ApprovalGateService(makeApprovalRepo());
    await expect(
      gate.assertApprovalAllows(
        makeHousehold({ approval_mode: 'owner_only' }),
        makeMembership('nanny'),
        'cancel'
      )
    ).rejects.toBeInstanceOf(NotHouseholdOwnerError);
  });
});

describe('ApprovalGateService.assertApprovalAllows — ask_other', () => {
  it('creates a pending approval when the action is in scope (short_notice_and_cancellations -> cancel)', async () => {
    const approvalRepo = makeApprovalRepo();
    const gate = new ApprovalGateService(approvalRepo);
    const household = makeHousehold({
      approval_mode: 'ask_other',
      approval_scope: 'short_notice_and_cancellations',
      approval_timeout_minutes: 60,
    });
    const result = await gate.assertApprovalAllows(
      household,
      makeMembership('parent'),
      'cancel',
      { shift_id: 's1' }
    );

    expect(result.needsApproval).toBe(true);
    if (result.needsApproval) {
      expect(result.approval.id).toBe('a-new');
    }
    expect(approvalRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'h1',
        requested_by: 'u1',
        action: 'cancel',
        payload: { shift_id: 's1' },
        status: 'pending',
      })
    );
  });

  it('does NOT create an approval when the action is out of scope (short_notice_and_cancellations -> extra_shift)', async () => {
    const approvalRepo = makeApprovalRepo();
    const gate = new ApprovalGateService(approvalRepo);
    const household = makeHousehold({
      approval_mode: 'ask_other',
      approval_scope: 'short_notice_and_cancellations',
    });
    const result = await gate.assertApprovalAllows(
      household,
      makeMembership('owner'),
      'extra_shift'
    );
    expect(result).toEqual({ needsApproval: false });
    expect(approvalRepo.create).not.toHaveBeenCalled();
  });

  it('creates a pending approval for ANY action when scope is all', async () => {
    const approvalRepo = makeApprovalRepo();
    const gate = new ApprovalGateService(approvalRepo);
    const household = makeHousehold({
      approval_mode: 'ask_other',
      approval_scope: 'all',
    });
    const result = await gate.assertApprovalAllows(
      household,
      makeMembership('owner'),
      'other'
    );
    expect(result.needsApproval).toBe(true);
  });

  it('sets timeout_at approval_timeout_minutes from now', async () => {
    const approvalRepo = makeApprovalRepo();
    const gate = new ApprovalGateService(approvalRepo);
    const household = makeHousehold({
      approval_mode: 'ask_other',
      approval_scope: 'all',
      approval_timeout_minutes: 30,
    });
    const before = Date.now();
    await gate.assertApprovalAllows(
      household,
      makeMembership('owner'),
      'other'
    );
    const [createArg] = approvalRepo.create.mock.calls[0];
    const timeoutAt = new Date(createArg.timeout_at).getTime();
    expect(timeoutAt).toBeGreaterThanOrEqual(before + 30 * 60_000 - 2000);
    expect(timeoutAt).toBeLessThanOrEqual(Date.now() + 30 * 60_000 + 2000);
  });

  it('rejects a nanny with NotAHouseholdParentError before ever checking scope', async () => {
    const approvalRepo = makeApprovalRepo();
    const gate = new ApprovalGateService(approvalRepo);
    await expect(
      gate.assertApprovalAllows(
        makeHousehold({ approval_mode: 'ask_other', approval_scope: 'all' }),
        makeMembership('nanny'),
        'cancel'
      )
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(approvalRepo.create).not.toHaveBeenCalled();
  });
});
