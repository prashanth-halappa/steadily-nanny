import { describe, expect, it, mock } from 'bun:test';
import {
  HouseholdNotFoundError,
  InviteNotFoundError,
} from '../../../../../src/domains/household/errors/householdErrors';
import { HouseholdQueryService } from '../../../../../src/domains/household/services/householdQueryService';
import type {
  Household,
  HouseholdInvite,
  HouseholdMember,
} from '../../../../../src/domains/household/types';

const household: Household = {
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
};

const membership: HouseholdMember = {
  id: 'm1',
  household_id: 'h1',
  user_id: 'u1',
  role: 'owner',
  can_edit: true,
  status: 'active',
  display_name_override: null,
  colour: null,
  joined_at: 't',
  created_at: 't',
  updated_at: 't',
};

const invite: HouseholdInvite = {
  id: 'i1',
  household_id: 'h1',
  code: 'ABC-234',
  email: null,
  role: 'nanny',
  invited_by: 'u1',
  expires_at: '2999-01-01T00:00:00Z',
  status: 'pending',
  accepted_by: null,
  accepted_at: null,
  created_at: 't',
  updated_at: 't',
};

function makeHouseholdRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => household),
    findByIds: mock(async () => [household]),
    listActiveChildFirstNames: mock(async () => ['Maya']),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveMembership: mock(async () => membership),
    listActiveByHousehold: mock(async () => [membership]),
    listActiveHouseholdIds: mock(async () => ['h1']),
    ...overrides,
  };
}

function makeInviteRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByCode: mock(async () => invite),
    ...overrides,
  };
}

describe('HouseholdQueryService.listForUser', () => {
  it('returns households the caller belongs to', async () => {
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo()
    );
    expect(await svc.listForUser('u1')).toEqual([household]);
  });

  it('returns [] without querying households when the caller has no memberships', async () => {
    const householdRepo = makeHouseholdRepo();
    const svc = new HouseholdQueryService(
      householdRepo,
      makeMemberRepo({ listActiveHouseholdIds: mock(async () => []) }),
      makeInviteRepo()
    );
    expect(await svc.listForUser('u1')).toEqual([]);
    expect(householdRepo.findByIds).not.toHaveBeenCalled();
  });
});

describe('HouseholdQueryService.getOwned', () => {
  it('returns the household when the caller is an active member', async () => {
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo()
    );
    expect(await svc.getOwned('u1', 'h1')).toEqual(household);
  });

  it('throws HouseholdNotFoundError when the caller is not a member', async () => {
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) }),
      makeInviteRepo()
    );
    await expect(svc.getOwned('u2', 'h1')).rejects.toBeInstanceOf(
      HouseholdNotFoundError
    );
  });

  it('throws the SAME HouseholdNotFoundError when the household does not exist at all (no existence leak)', async () => {
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) }),
      makeInviteRepo()
    );
    await expect(svc.getOwned('u2', 'missing')).rejects.toBeInstanceOf(
      HouseholdNotFoundError
    );
  });
});

describe('HouseholdQueryService.getMembership', () => {
  it('returns the membership row', async () => {
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo()
    );
    expect(await svc.getMembership('u1', 'h1')).toEqual(membership);
  });

  it('throws HouseholdNotFoundError for a non-member', async () => {
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) }),
      makeInviteRepo()
    );
    await expect(svc.getMembership('u2', 'h1')).rejects.toBeInstanceOf(
      HouseholdNotFoundError
    );
  });
});

describe('HouseholdQueryService.listMembers', () => {
  it('lists members once membership is confirmed', async () => {
    const memberRepo = makeMemberRepo();
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo()
    );
    expect(await svc.listMembers('u1', 'h1')).toEqual([membership]);
  });

  it('throws HouseholdNotFoundError for a non-member', async () => {
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) }),
      makeInviteRepo()
    );
    await expect(svc.listMembers('u2', 'h1')).rejects.toBeInstanceOf(
      HouseholdNotFoundError
    );
  });
});

describe('HouseholdQueryService.previewInvite', () => {
  it('returns household name, active children first names, and the proposed role — no membership required', async () => {
    const memberRepo = makeMemberRepo({
      findActiveMembership: mock(async () => {
        throw new Error('must not be called — preview is not membership-gated');
      }),
    });
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo()
    );
    const preview = await svc.previewInvite('ABC-234');
    expect(preview).toEqual({
      household_name: 'The Smiths',
      children_first_names: ['Maya'],
      role: 'nanny',
    });
  });

  it('throws InviteNotFoundError for an unknown code', async () => {
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo({ findByCode: mock(async () => null) })
    );
    await expect(svc.previewInvite('ZZZ-999')).rejects.toBeInstanceOf(
      InviteNotFoundError
    );
  });
});
