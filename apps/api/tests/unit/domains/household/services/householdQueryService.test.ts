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
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  currency: 'GBP',
  jurisdiction: null,
  week_starts_on: 1,
  state: 'live',
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
  link_expires_at: null,
  opened_at: null,
  label: null,
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
    listNonRemovedByHousehold: mock(async () => [membership]),
    listActiveHouseholdIds: mock(async () => ['h1']),
    listRemovedHouseholdIds: mock(async () => []),
    listActiveByUser: mock(async () => [membership]),
    listByUser: mock(async () => [membership]),
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

describe('HouseholdQueryService.listPastForUser', () => {
  const pastHousehold: Household = {
    ...household,
    id: 'h9',
    name: 'The Joneses',
  };

  it('returns the households the caller was removed from', async () => {
    const svc = new HouseholdQueryService(
      makeHouseholdRepo({ findByIds: mock(async () => [pastHousehold]) }),
      makeMemberRepo({ listRemovedHouseholdIds: mock(async () => ['h9']) }),
      makeInviteRepo()
    );
    expect(await svc.listPastForUser('u1')).toEqual([pastHousehold]);
  });

  it('returns [] without querying households when the caller was never removed', async () => {
    const householdRepo = makeHouseholdRepo();
    const svc = new HouseholdQueryService(
      householdRepo,
      makeMemberRepo(),
      makeInviteRepo()
    );
    expect(await svc.listPastForUser('u1')).toEqual([]);
    expect(householdRepo.findByIds).not.toHaveBeenCalled();
  });

  it('never returns a household the caller is still active in', async () => {
    const memberRepo = makeMemberRepo();
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo()
    );
    expect(await svc.listPastForUser('u1')).toEqual([]);
    expect(memberRepo.listActiveHouseholdIds).not.toHaveBeenCalled();
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
    expect(memberRepo.listNonRemovedByHousehold).toHaveBeenCalledWith('h1');
    expect(memberRepo.listActiveByHousehold).not.toHaveBeenCalled();
  });

  // D-38 / §7.1: the inbox fans terms-proposal queries from this roster and
  // deliberately includes `candidate` rows — acceptance is when they matter most.
  it('returns a candidate nanny the active-only roster would have hidden', async () => {
    const candidate: HouseholdMember = {
      ...membership,
      id: 'm2',
      user_id: 'u2',
      role: 'nanny',
      status: 'candidate',
    };
    const memberRepo = makeMemberRepo({
      listNonRemovedByHousehold: mock(async () => [membership, candidate]),
    });
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo()
    );
    expect(await svc.listMembers('u1', 'h1')).toEqual([membership, candidate]);
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

describe('HouseholdQueryService.listMembershipsForUser', () => {
  it('delegates to the member repository, across all households', async () => {
    const memberRepo = makeMemberRepo();
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      memberRepo,
      makeInviteRepo()
    );
    expect(await svc.listMembershipsForUser('u1')).toEqual([membership]);
    expect(memberRepo.listByUser).toHaveBeenCalledWith('u1');
  });

  // THE contract this endpoint owes the client. `GET /v1/users/me/memberships`
  // is the only source mobile has for "what am I in each household", and
  // `useIsOnboarded` reads `status === 'removed'` off these rows to decide
  // both that a removed nanny is still onboarded (not a fresh signup) and
  // that every write affordance must be suppressed. Filtering removed rows out
  // here made that gate permanently false and routed a past-only nanny into
  // the signup wizard, putting the pay she is owed out of reach.
  it('returns REMOVED rows too — the client cannot gate on what it never receives', async () => {
    const removed: HouseholdMember = {
      ...membership,
      id: 'm2',
      household_id: 'h2',
      role: 'nanny',
      status: 'removed',
    };
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      makeMemberRepo({ listByUser: mock(async () => [membership, removed]) }),
      makeInviteRepo()
    );
    expect(await svc.listMembershipsForUser('u1')).toEqual([
      membership,
      removed,
    ]);
  });

  it('returns [] when the caller belongs to no households', async () => {
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      makeMemberRepo({ listByUser: mock(async () => []) }),
      makeInviteRepo()
    );
    expect(await svc.listMembershipsForUser('u2')).toEqual([]);
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
      household_state: 'live',
      carer_name: null,
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

  // Preview is the ONLY unauthenticated read in this domain: anyone holding a
  // string can call it. Answering for a dead code hands a stranger the family's
  // household name and the children's first names off a code that grants
  // nothing — a revoked one is the worst case, because revoking is exactly how
  // a parent takes access back. The refusal is the SAME error as "no such
  // code" in every case, matching the domain's existence-hiding convention:
  // telling the caller WHY confirms the code was real.
  it('throws InviteNotFoundError for a REVOKED code, without disclosing anything about the household', async () => {
    const householdRepo = makeHouseholdRepo();
    const svc = new HouseholdQueryService(
      householdRepo,
      makeMemberRepo(),
      makeInviteRepo({
        findByCode: mock(async () => ({ ...invite, status: 'revoked' })),
      })
    );

    await expect(svc.previewInvite('ABC-234')).rejects.toBeInstanceOf(
      InviteNotFoundError
    );
    expect(householdRepo.listActiveChildFirstNames).not.toHaveBeenCalled();
  });

  it('throws InviteNotFoundError for an ACCEPTED code — a used code previews nothing', async () => {
    const householdRepo = makeHouseholdRepo();
    const svc = new HouseholdQueryService(
      householdRepo,
      makeMemberRepo(),
      makeInviteRepo({
        findByCode: mock(async () => ({
          ...invite,
          status: 'accepted',
          accepted_by: 'u2',
          accepted_at: '2026-01-01T00:00:00Z',
        })),
      })
    );

    await expect(svc.previewInvite('ABC-234')).rejects.toBeInstanceOf(
      InviteNotFoundError
    );
    expect(householdRepo.listActiveChildFirstNames).not.toHaveBeenCalled();
  });

  it('throws InviteNotFoundError for a pending-but-EXPIRED code', async () => {
    // Nothing flips `status` to 'expired' on a schedule — expiry is decided by
    // comparing `expires_at`, exactly as redeemInvite does. A row left
    // 'pending' forever is the normal case, so a status check alone would let
    // every long-dead code keep previewing.
    const householdRepo = makeHouseholdRepo();
    const svc = new HouseholdQueryService(
      householdRepo,
      makeMemberRepo(),
      makeInviteRepo({
        findByCode: mock(async () => ({
          ...invite,
          expires_at: '2000-01-01T00:00:00Z',
        })),
      })
    );

    await expect(svc.previewInvite('ABC-234')).rejects.toBeInstanceOf(
      InviteNotFoundError
    );
    expect(householdRepo.listActiveChildFirstNames).not.toHaveBeenCalled();
  });

  it('still previews a live pending code', async () => {
    const svc = new HouseholdQueryService(
      makeHouseholdRepo(),
      makeMemberRepo(),
      makeInviteRepo()
    );
    await expect(svc.previewInvite('ABC-234')).resolves.toEqual({
      household_name: 'The Smiths',
      children_first_names: ['Maya'],
      role: 'nanny',
      household_state: 'live',
      carer_name: null,
    });
  });
});

/**
 * §8.2 — the absorption confirm sheet fires from THIS call. "The redeemer
 * already has a live household" cannot tell a nanny's draft code apart from an
 * ordinary co-parent invite to a second family, so the kind of code has to
 * come from the server.
 */
describe('HouseholdQueryService.previewInvite — a nanny-authored draft', () => {
  const draft = {
    ...household,
    id: 'h-draft',
    name: null,
    state: 'draft',
    created_by: 'u-nanny',
  };
  const proposalRepo: any = {
    findOpenForCarer: mock(async () => ({
      carer_display_name: 'Marisol Mendez',
    })),
  };

  function draftSvc(overrides: Record<string, unknown> = {}) {
    return new HouseholdQueryService(
      makeHouseholdRepo({ findById: mock(async () => draft) }),
      makeMemberRepo(),
      makeInviteRepo(),
      undefined,
      { ...proposalRepo, ...overrides } as any
    );
  }

  it('answers, and says which kind of code it is', async () => {
    const preview = await draftSvc().previewInvite('ABC-234');

    expect(preview.household_state).toBe('draft');
    expect(preview.carer_name).toBe('Marisol M.');
  });

  it('names her the same way the public page does — first name, last initial', async () => {
    // Same helper as `termsPreview`, so the sheet and the web page can never
    // introduce her differently.
    const preview = await draftSvc().previewInvite('ABC-234');
    expect(preview.carer_name).not.toContain('Mendez');
  });

  it('discloses no family name and no children — a draft has neither to give', async () => {
    // The "children" in a draft are the placeholders SHE typed while pricing
    // her own week. They are not this family's children and must not be
    // rendered as though they were.
    const preview = await draftSvc().previewInvite('ABC-234');

    expect(preview.household_name).toBe('');
    expect(preview.children_first_names).toEqual([]);
  });

  it('still answers when she has no open proposal to name her', async () => {
    const preview = await draftSvc({
      findOpenForCarer: mock(async () => null),
    }).previewInvite('ABC-234');

    expect(preview.household_state).toBe('draft');
    expect(preview.carer_name).toBeNull();
  });
});
