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
