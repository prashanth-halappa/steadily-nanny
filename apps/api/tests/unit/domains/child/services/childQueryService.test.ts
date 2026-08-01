import { describe, expect, it, mock } from 'bun:test';
import { ChildNotFoundError } from '../../../../../src/domains/child/errors/childErrors';
import { ChildQueryService } from '../../../../../src/domains/child/services/childQueryService';

const child = {
  id: 'c1',
  household_id: 'h1',
  name: 'Maya',
  birth_date: '2021-01-01',
  colour: null,
  avatar_initial: null,
  routine_notes: null,
  archived_at: null,
  created_at: 't',
  updated_at: 't',
};

function makeRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveByHousehold: mock(async () => [child]),
    findById: mock(async () => child),
    ...overrides,
  };
}

function makeHouseholds(overrides: Record<string, unknown> = {}): any {
  return {
    getMembership: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'u1',
      role: 'nanny',
    })),
    ...overrides,
  };
}

describe('ChildQueryService.listForHousehold', () => {
  it('lists active children once membership is confirmed', async () => {
    const repo = makeRepo();
    const households = makeHouseholds();
    const svc = new ChildQueryService(repo, households);
    expect(await svc.listForHousehold('u1', 'h1')).toEqual([child]);
    expect(households.getMembership).toHaveBeenCalledWith('u1', 'h1');
    expect(repo.findActiveByHousehold).toHaveBeenCalledWith('h1');
  });

  it("propagates the household service's not-a-member error", async () => {
    const households = makeHouseholds({
      getMembership: mock(async () => {
        throw new Error('HOUSEHOLD_NOT_FOUND');
      }),
    });
    const svc = new ChildQueryService(makeRepo(), households);
    await expect(svc.listForHousehold('u2', 'h1')).rejects.toThrow(
      'HOUSEHOLD_NOT_FOUND'
    );
  });
});

describe('ChildQueryService.getOwned', () => {
  it('returns the child when it belongs to the household and the caller is a member', async () => {
    const svc = new ChildQueryService(makeRepo(), makeHouseholds());
    expect(await svc.getOwned('u1', 'h1', 'c1')).toEqual(child);
  });

  it('resolves an archived child (soft delete does not hide it from getOwned)', async () => {
    const archived = { ...child, archived_at: 't2' };
    const svc = new ChildQueryService(
      makeRepo({ findById: mock(async () => archived) }),
      makeHouseholds()
    );
    expect(await svc.getOwned('u1', 'h1', 'c1')).toEqual(archived);
  });

  it('throws ChildNotFoundError when the child does not exist', async () => {
    const svc = new ChildQueryService(
      makeRepo({ findById: mock(async () => null) }),
      makeHouseholds()
    );
    await expect(svc.getOwned('u1', 'h1', 'missing')).rejects.toBeInstanceOf(
      ChildNotFoundError
    );
  });

  it('throws ChildNotFoundError when the child belongs to a different household (no existence leak)', async () => {
    const svc = new ChildQueryService(
      makeRepo({
        findById: mock(async () => ({ ...child, household_id: 'h-other' })),
      }),
      makeHouseholds()
    );
    await expect(svc.getOwned('u1', 'h1', 'c1')).rejects.toBeInstanceOf(
      ChildNotFoundError
    );
  });

  it('throws ChildNotFoundError when the caller is not a member of the household', async () => {
    const households = makeHouseholds({
      getMembership: mock(async () => {
        throw new Error('HOUSEHOLD_NOT_FOUND');
      }),
    });
    const svc = new ChildQueryService(makeRepo(), households);
    await expect(svc.getOwned('u2', 'h1', 'c1')).rejects.toThrow(
      'HOUSEHOLD_NOT_FOUND'
    );
  });
});
