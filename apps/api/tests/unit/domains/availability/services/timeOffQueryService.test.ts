import { describe, expect, it, mock } from 'bun:test';
import { TimeOffNotFoundError } from '../../../../../src/domains/availability/errors/availabilityErrors';
import { TimeOffQueryService } from '../../../../../src/domains/availability/services/timeOffQueryService';
import type { CarerTimeOff } from '../../../../../src/domains/availability/types';
import { HouseholdNotFoundError } from '../../../../../src/domains/household/errors/householdErrors';

const row: CarerTimeOff = {
  id: 't1',
  user_id: 'nanny-1',
  starts_at: '2026-08-10T00:00:00Z',
  ends_at: '2026-08-12T00:00:00Z',
  all_day: true,
  message: null,
  status: 'confirmed',
  ical_uid: 'ical-1',
  sequence: 0,
  created_at: 't',
  updated_at: 't',
};

function makeTimeOffRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listByUserId: mock(async () => [row]),
    listByUserIds: mock(async () => [row]),
    findById: mock(async () => row),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveMembership: mock(async () => ({
      id: 'm1',
      household_id: 'hh1',
      user_id: 'parent-1',
      role: 'parent',
      status: 'active',
    })),
    listActiveByHousehold: mock(async () => [
      {
        id: 'm2',
        household_id: 'hh1',
        user_id: 'nanny-1',
        role: 'nanny',
        status: 'active',
      },
      {
        id: 'm3',
        household_id: 'hh1',
        user_id: 'parent-1',
        role: 'parent',
        status: 'active',
      },
      {
        id: 'm4',
        household_id: 'hh1',
        user_id: 'helper-1',
        role: 'helper',
        status: 'active',
      },
    ]),
    ...overrides,
  };
}

describe('TimeOffQueryService.listOwn', () => {
  it("returns the caller's own time-off rows", async () => {
    const timeOffRepo = makeTimeOffRepo();
    const svc = new TimeOffQueryService(timeOffRepo, makeMemberRepo());
    expect(await svc.listOwn('u1')).toEqual([row]);
    expect(timeOffRepo.listByUserId).toHaveBeenCalledWith('u1');
  });
});

describe('TimeOffQueryService.listForHousehold', () => {
  it('lists time off for nanny members only (helpers are not carers) after membership check', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const memberRepo = makeMemberRepo();
    const svc = new TimeOffQueryService(timeOffRepo, memberRepo);

    expect(await svc.listForHousehold('parent-1', 'hh1')).toEqual([row]);
    expect(memberRepo.findActiveMembership).toHaveBeenCalledWith(
      'hh1',
      'parent-1'
    );
    // helper-1 must NOT be included — CARER_ROLES is nanny-only, matching
    // timesheet/shift/schedule domains.
    expect(timeOffRepo.listByUserIds).toHaveBeenCalledWith(['nanny-1']);
  });

  it('throws HouseholdNotFoundError when caller is not a member', async () => {
    const svc = new TimeOffQueryService(
      makeTimeOffRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) })
    );
    await expect(
      svc.listForHousehold('stranger', 'hh1')
    ).rejects.toBeInstanceOf(HouseholdNotFoundError);
  });
});

describe('TimeOffQueryService.getOwned', () => {
  it('returns the row when it belongs to the caller', async () => {
    const svc = new TimeOffQueryService(makeTimeOffRepo(), makeMemberRepo());
    expect(await svc.getOwned('nanny-1', 't1')).toEqual(row);
  });

  it('throws TimeOffNotFoundError when the row belongs to someone else', async () => {
    const svc = new TimeOffQueryService(makeTimeOffRepo(), makeMemberRepo());
    await expect(svc.getOwned('someone-else', 't1')).rejects.toBeInstanceOf(
      TimeOffNotFoundError
    );
  });

  it('throws the SAME TimeOffNotFoundError when the row does not exist at all', async () => {
    const svc = new TimeOffQueryService(
      makeTimeOffRepo({ findById: mock(async () => null) }),
      makeMemberRepo()
    );
    await expect(svc.getOwned('u1', 'missing')).rejects.toBeInstanceOf(
      TimeOffNotFoundError
    );
  });
});

// ---------------------------------------------------------------------------
// `carer_time_off` is PERSON-scoped — no household_id on the row — so the
// time-off write paths had no household to authorize against and ended up
// authorizing against nothing at all: POST /v1/time-off was a bare insert and
// DELETE checked only `user_id`. A nanny removed from every household she
// worked for still got a 201, and her DELETE still drove
// `reconcileCancelledTimeOff` into a past household's `pto_ledger` — a money
// write by a non-member. The API runs on the service-role key and migration
// 049 dropped the client write policies, so this TypeScript gate is the ONLY
// gate; RLS does not back it up.
// ---------------------------------------------------------------------------
describe('TimeOffQueryService.assertActiveMember', () => {
  it('refuses a caller with no active membership anywhere', async () => {
    const svc = new TimeOffQueryService(
      makeTimeOffRepo(),
      makeMemberRepo({ listActiveByUser: mock(async () => []) })
    );
    await expect(svc.assertActiveMember('removed-nanny')).rejects.toMatchObject(
      { statusCode: 403 }
    );
  });

  // The discriminating half: a gate that refuses everyone passes the case
  // above and fails this one.
  it('allows a caller holding at least one active membership', async () => {
    const memberRepo = makeMemberRepo({
      listActiveByUser: mock(async () => [
        { id: 'm1', household_id: 'hh1', user_id: 'nanny-1', status: 'active' },
      ]),
    });
    const svc = new TimeOffQueryService(makeTimeOffRepo(), memberRepo);

    await svc.assertActiveMember('nanny-1');

    expect(memberRepo.listActiveByUser).toHaveBeenCalledWith('nanny-1');
  });

  // A membership row that EXISTS but is `removed` must not count. Pinned
  // separately because the repository call is the thing doing the filtering:
  // swapping `listActiveByUser` for the status-unfiltered `listByUser` (which
  // `listMembershipsForUser` now uses) would silently reopen the hole.
  it('does not count a removed membership row as active', async () => {
    const svc = new TimeOffQueryService(
      makeTimeOffRepo(),
      makeMemberRepo({
        // What the active-only repository query returns for a user whose only
        // row is `removed`: nothing.
        listActiveByUser: mock(async () => []),
        listByUser: mock(async () => [
          {
            id: 'm1',
            household_id: 'hh1',
            user_id: 'nanny-1',
            status: 'removed',
          },
        ]),
      })
    );
    await expect(svc.assertActiveMember('nanny-1')).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
