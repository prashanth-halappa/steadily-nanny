import { describe, expect, it } from 'bun:test';
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
    short_notice_hours: 24,
    cancellation_paid_within_hours: 24,
    currency: 'GBP',
    jurisdiction: null,
    week_starts_on: 1,
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

describe('ApprovalGateService.assertApprovalAllows — either', () => {
  it('allows an owner to proceed', async () => {
    const gate = new ApprovalGateService();
    await gate.assertApprovalAllows(
      makeHousehold({ approval_mode: 'either' }),
      makeMembership('owner'),
      'cancel'
    );
  });

  it('allows a parent to proceed', async () => {
    const gate = new ApprovalGateService();
    await gate.assertApprovalAllows(
      makeHousehold({ approval_mode: 'either' }),
      makeMembership('parent'),
      'short_notice_change'
    );
  });

  it('treats a household previously on ask_other like either once migrated', async () => {
    const gate = new ApprovalGateService();
    await gate.assertApprovalAllows(
      makeHousehold({ approval_mode: 'either' }),
      makeMembership('parent'),
      'extra_shift'
    );
  });

  it('rejects a nanny with NotAHouseholdParentError', async () => {
    const gate = new ApprovalGateService();
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
    const gate = new ApprovalGateService();
    await gate.assertApprovalAllows(
      makeHousehold({ approval_mode: 'owner_only' }),
      makeMembership('owner'),
      'cancel'
    );
  });

  it('rejects a parent (non-owner) with NotHouseholdOwnerError', async () => {
    const gate = new ApprovalGateService();
    await expect(
      gate.assertApprovalAllows(
        makeHousehold({ approval_mode: 'owner_only' }),
        makeMembership('parent'),
        'cancel'
      )
    ).rejects.toBeInstanceOf(NotHouseholdOwnerError);
  });

  it('rejects a nanny with NotHouseholdOwnerError', async () => {
    const gate = new ApprovalGateService();
    await expect(
      gate.assertApprovalAllows(
        makeHousehold({ approval_mode: 'owner_only' }),
        makeMembership('nanny'),
        'cancel'
      )
    ).rejects.toBeInstanceOf(NotHouseholdOwnerError);
  });
});
