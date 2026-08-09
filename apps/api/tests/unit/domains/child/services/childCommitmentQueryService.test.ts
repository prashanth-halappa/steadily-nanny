import { describe, expect, it, mock } from 'bun:test';
import { ChildCommitmentNotFoundError } from '../../../../../src/domains/child/errors/childErrors';
import { ChildCommitmentQueryService } from '../../../../../src/domains/child/services/childCommitmentQueryService';

const commitment = {
  id: 'cm1',
  child_id: 'c1',
  household_id: 'h1',
  kind: 'preschool' as const,
  label: 'Preschool',
  rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH',
  start_time: '09:00:00',
  end_time: '12:00:00',
  starts_on: null,
  ends_on: null,
  exdates: [],
  created_at: 't',
  updated_at: 't',
};

function makeRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByChildId: mock(async () => [commitment]),
    findByHouseholdId: mock(async () => [commitment]),
    findById: mock(async () => commitment),
    ...overrides,
  };
}

function makeChildren(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(async () => ({ id: 'c1', household_id: 'h1' })),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveMembership: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'u1',
      role: 'nanny',
    })),
    ...overrides,
  };
}

describe('ChildCommitmentQueryService.listForChild', () => {
  it('lists commitments once the child is confirmed owned', async () => {
    const repo = makeRepo();
    const children = makeChildren();
    const svc = new ChildCommitmentQueryService(
      repo,
      children,
      makeMemberRepo()
    );
    expect(await svc.listForChild('u1', 'h1', 'c1')).toEqual([commitment]);
    expect(children.getOwned).toHaveBeenCalledWith('u1', 'h1', 'c1');
    expect(repo.findByChildId).toHaveBeenCalledWith('c1');
  });

  it("propagates the child service's not-found/not-a-member error", async () => {
    const children = makeChildren({
      getOwned: mock(async () => {
        throw new Error('CHILD_NOT_FOUND');
      }),
    });
    const svc = new ChildCommitmentQueryService(
      makeRepo(),
      children,
      makeMemberRepo()
    );
    await expect(svc.listForChild('u2', 'h1', 'c1')).rejects.toThrow(
      'CHILD_NOT_FOUND'
    );
  });
});

describe('ChildCommitmentQueryService.listForHousehold', () => {
  it('returns commitments for an active household member', async () => {
    const repo = makeRepo({
      findByHouseholdId: mock(async () => [commitment]),
    });
    const svc = new ChildCommitmentQueryService(
      repo,
      makeChildren(),
      makeMemberRepo()
    );
    expect(await svc.listForHousehold('u1', 'h1')).toEqual([commitment]);
    expect(repo.findByHouseholdId).toHaveBeenCalledWith('h1');
  });

  it('throws when the caller is not an active member', async () => {
    const svc = new ChildCommitmentQueryService(
      makeRepo({ findByHouseholdId: mock(async () => [commitment]) }),
      makeChildren(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) })
    );
    await expect(svc.listForHousehold('u2', 'h1')).rejects.toBeInstanceOf(
      ChildCommitmentNotFoundError
    );
  });
});

describe('ChildCommitmentQueryService.getOwned', () => {
  it('returns the commitment when the caller is a member of its household', async () => {
    const svc = new ChildCommitmentQueryService(
      makeRepo(),
      makeChildren(),
      makeMemberRepo()
    );
    expect(await svc.getOwned('u1', 'cm1')).toEqual(commitment);
  });

  it('throws ChildCommitmentNotFoundError when the commitment does not exist', async () => {
    const svc = new ChildCommitmentQueryService(
      makeRepo({ findById: mock(async () => null) }),
      makeChildren(),
      makeMemberRepo()
    );
    await expect(svc.getOwned('u1', 'missing')).rejects.toBeInstanceOf(
      ChildCommitmentNotFoundError
    );
  });

  it('throws ChildCommitmentNotFoundError when the caller is not a member of its household (no existence leak)', async () => {
    const svc = new ChildCommitmentQueryService(
      makeRepo(),
      makeChildren(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) })
    );
    await expect(svc.getOwned('u2', 'cm1')).rejects.toBeInstanceOf(
      ChildCommitmentNotFoundError
    );
  });
});
