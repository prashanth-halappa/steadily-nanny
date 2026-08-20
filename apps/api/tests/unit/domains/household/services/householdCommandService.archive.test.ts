/**
 * `archive` — closing a household without deleting anything (A4/A10).
 *
 * The mechanism is the whole design and is worth restating where the tests
 * live: archiving is the CALLER'S OWN MEMBERSHIP set to `removed`, and nothing
 * else. No `archived_at`, no third `households.state`, no migration. What
 * makes that sufficient is that four shipped mechanisms already key off that
 * row — "Past households" reads `removed`, `listForUser` drops it, every write
 * gate is active-only, and 094's `draft_has_no_author` kills a draft's
 * outstanding codes. These tests pin the RULES around the flip; the flip
 * itself is `removeMembership`, which has its own tests.
 */
import { describe, expect, it, mock } from 'bun:test';
import {
  HouseholdHasCarerError,
  HouseholdNotFoundError,
  NotAHouseholdParentError,
} from '../../../../../src/domains/household/errors/householdErrors';
import { HouseholdCommandService } from '../../../../../src/domains/household/services/householdCommandService';
import type {
  Household,
  HouseholdMember,
} from '../../../../../src/domains/household/types';

const PARENT_ID = 'u-parent';
const NANNY_ID = 'u-nanny';

const liveHousehold: Household = {
  id: 'h1',
  name: 'The Ahmeds',
  timezone: 'America/Chicago',
  address_line: null,
  latitude: null,
  longitude: null,
  approval_mode: 'either',
  approval_scope: 'short_notice_and_cancellations',
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  currency: 'USD',
  jurisdiction: null,
  week_starts_on: 1,
  country: 'US',
  state: 'live',
  created_by: PARENT_ID,
  created_at: 't',
  updated_at: 't',
};

/** Her draft: no name, no owner, created by her (093's CHECK). */
const draftHousehold: Household = {
  ...liveHousehold,
  id: 'h-draft',
  name: null,
  state: 'draft',
  created_by: NANNY_ID,
};

function member(overrides: Partial<HouseholdMember> = {}): HouseholdMember {
  return {
    id: 'm-owner',
    household_id: 'h1',
    user_id: PARENT_ID,
    role: 'owner',
    can_edit: true,
    status: 'active',
    display_name_override: null,
    colour: null,
    joined_at: 't',
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

const draftAuthor = member({
  id: 'm-draft',
  household_id: 'h-draft',
  user_id: NANNY_ID,
  role: 'nanny',
  can_edit: false,
});

function makeService(parts: {
  household?: Household | null;
  membership?: HouseholdMember;
  memberRepo?: any;
  queries?: any;
}) {
  const memberRepo: any = parts.memberRepo ?? {
    listActiveByHousehold: mock(async () => []),
    // 110: `removeMember` stamps `ended_reason` through the generic update
    // right after the CAS flip.
    update: mock(async (id: string, patch: Record<string, unknown>) => ({
      id,
      ...patch,
    })),
    removeMembership: mock(async (id: string) => ({
      ...member(),
      id,
      status: 'removed',
    })),
  };
  const householdRepo: any = {
    findById: mock(async () => parts.household ?? liveHousehold),
  };
  const queries: any = parts.queries ?? {
    getMembership: mock(async () => parts.membership ?? member()),
  };
  const svc = new HouseholdCommandService(
    householdRepo,
    memberRepo,
    {} as any,
    queries
  );
  return { svc, memberRepo, householdRepo, queries };
}

describe('archive — who may close a household', () => {
  it('flips the OWNER’s own membership to removed', async () => {
    // Note the contrast with `leave`, which refuses the owner outright: there
    // the household must not be orphaned, here being orphaned is the point.
    const { svc, memberRepo } = makeService({});

    const result = await svc.archive(PARENT_ID, 'h1');

    expect(memberRepo.removeMembership).toHaveBeenCalledWith('m-owner');
    expect(result.status).toBe('removed');
  });

  it('lets the draft author close her own draft, with no carer check', async () => {
    // She IS the nanny in it. Running the carer check here would make a draft
    // permanently unarchivable — the exact zombie A6 exists to kill.
    const memberRepo = {
      listActiveByHousehold: mock(async () => []),
      removeMembership: mock(async (id: string) => ({
        ...draftAuthor,
        id,
        status: 'removed',
      })),
    };
    const { svc } = makeService({
      household: draftHousehold,
      membership: draftAuthor,
      memberRepo,
    });

    const result = await svc.archive(NANNY_ID, 'h-draft');

    expect(memberRepo.removeMembership).toHaveBeenCalledWith('m-draft');
    expect(memberRepo.listActiveByHousehold).not.toHaveBeenCalled();
    expect(result.status).toBe('removed');
  });

  it('refuses a non-member with the ordinary 404 — existence is not leaked', async () => {
    const { svc, memberRepo } = makeService({
      queries: {
        getMembership: mock(async () => {
          throw new HouseholdNotFoundError('h1');
        }),
      },
    });

    await expect(svc.archive('u-stranger', 'h1')).rejects.toThrow(
      HouseholdNotFoundError
    );
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });

  it('refuses a NANNY in a live household — walking out is `leave`, not this', async () => {
    // `leave` carries the clocked-in refusal and end-dates her pay. Archiving
    // does neither, and must not become a door around them.
    const { svc, memberRepo } = makeService({
      membership: member({ id: 'm-nanny', user_id: NANNY_ID, role: 'nanny' }),
    });

    await expect(svc.archive(NANNY_ID, 'h1')).rejects.toThrow(
      NotAHouseholdParentError
    );
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });
});

describe('archive — the carer guard (A4)', () => {
  it('refuses while another active member is a nanny', async () => {
    const memberRepo = {
      listActiveByHousehold: mock(async () => [
        member(),
        member({ id: 'm-nanny', user_id: NANNY_ID, role: 'nanny' }),
      ]),
      removeMembership: mock(async () => null),
    };
    const { svc } = makeService({ memberRepo });

    await expect(svc.archive(PARENT_ID, 'h1')).rejects.toThrow(
      HouseholdHasCarerError
    );
    expect(memberRepo.removeMembership).not.toHaveBeenCalled();
  });

  it('allows it when the only other member is a co-parent', async () => {
    // The guard is about the CARER, not about being alone. A co-parent has his
    // own membership and can archive on his own account.
    const memberRepo = {
      listActiveByHousehold: mock(async () => [
        member(),
        member({ id: 'm-coparent', user_id: 'u-coparent', role: 'parent' }),
      ]),
      removeMembership: mock(async (id: string) => ({
        ...member(),
        id,
        status: 'removed',
      })),
    };
    const { svc } = makeService({ memberRepo });

    await svc.archive(PARENT_ID, 'h1');

    expect(memberRepo.removeMembership).toHaveBeenCalledWith('m-owner');
  });
});
