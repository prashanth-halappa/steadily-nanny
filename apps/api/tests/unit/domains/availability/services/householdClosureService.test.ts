/**
 * Parent-declared household closures — parent-gated writes, member-visible reads.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { HouseholdClosure } from '../../../../../src/domains/availability/types';
import { NotAHouseholdParentError } from '../../../../../src/domains/household/errors/householdErrors';

const closure: HouseholdClosure = {
  id: 'c1',
  household_id: 'hh1',
  starts_at: '2026-08-20T00:00:00Z',
  ends_at: '2026-08-27T00:00:00Z',
  message: "We're away",
  created_by: 'parent-1',
  created_at: 't',
  updated_at: 't',
};

let HouseholdClosureCommandService: typeof import('../../../../../src/domains/availability/services/householdClosureCommandService').HouseholdClosureCommandService;
let HouseholdClosureQueryService: typeof import('../../../../../src/domains/availability/services/householdClosureQueryService').HouseholdClosureQueryService;
let HouseholdClosureNotFoundError: typeof import('../../../../../src/domains/availability/errors/availabilityErrors').HouseholdClosureNotFoundError;

beforeAll(async () => {
  mock.module(
    '../../../../../src/domains/child/services/detectUncoveredCareForDate',
    () => ({
      detectUncoveredCareForDate: mock(async () => []),
      detectUncoveredCareBestEffort: mock(() => undefined),
    })
  );
  ({ HouseholdClosureCommandService } = await import(
    '../../../../../src/domains/availability/services/householdClosureCommandService'
  ));
  ({ HouseholdClosureQueryService } = await import(
    '../../../../../src/domains/availability/services/householdClosureQueryService'
  ));
  ({ HouseholdClosureNotFoundError } = await import(
    '../../../../../src/domains/availability/errors/availabilityErrors'
  ));
});

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    listByHousehold: mock(async () => [closure]),
    findById: mock(async () => closure),
    create: mock(async (data: Record<string, unknown>) => ({
      ...closure,
      ...data,
      id: 'c-new',
    })),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...closure,
      id,
      ...data,
    })),
    delete: mock(async () => undefined),
    ...overrides,
  };
}

function makeHouseholds(
  role = 'parent',
  overrides: Record<string, unknown> = {}
) {
  return {
    getMembership: mock(async () => ({
      id: 'm1',
      household_id: 'hh1',
      user_id: 'u1',
      role,
      status: 'active',
    })),
    getOwned: mock(async () => ({
      id: 'hh1',
      name: 'Smiths',
      timezone: 'UTC',
    })),
    ...overrides,
  };
}

describe('HouseholdClosureQueryService', () => {
  it('lists closures for any active household member (nanny included)', async () => {
    const repo = makeRepo();
    const households = makeHouseholds('nanny');
    const svc = new HouseholdClosureQueryService(
      repo as never,
      households as never
    );

    expect(await svc.listForHousehold('nanny-1', 'hh1')).toEqual([closure]);
    expect(households.getMembership).toHaveBeenCalledWith('nanny-1', 'hh1');
    expect(repo.listByHousehold).toHaveBeenCalledWith('hh1');
  });

  it('throws HouseholdClosureNotFoundError when the row is missing or wrong household', async () => {
    const svc = new HouseholdClosureQueryService(
      makeRepo({ findById: mock(async () => null) }) as never,
      makeHouseholds() as never
    );
    await expect(
      svc.getOwned('parent-1', 'hh1', 'missing')
    ).rejects.toBeInstanceOf(HouseholdClosureNotFoundError);
  });
});

describe('HouseholdClosureCommandService', () => {
  it('creates a closure when the caller is a parent', async () => {
    const repo = makeRepo();
    const svc = new HouseholdClosureCommandService(
      repo as never,
      makeHouseholds('parent') as never,
      {
        getOwned: mock(async () => closure),
      } as never
    );

    const result = await svc.create('parent-1', 'hh1', {
      starts_at: '2026-08-20T00:00:00Z',
      ends_at: '2026-08-27T00:00:00Z',
      message: "We're away",
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'hh1',
        created_by: 'parent-1',
        message: "We're away",
      })
    );
    expect(result.id).toBe('c-new');
  });

  it('rejects create from a nanny (parent-gated)', async () => {
    const repo = makeRepo();
    const svc = new HouseholdClosureCommandService(
      repo as never,
      makeHouseholds('nanny') as never,
      { getOwned: mock(async () => closure) } as never
    );

    await expect(
      svc.create('nanny-1', 'hh1', {
        starts_at: '2026-08-20T00:00:00Z',
        ends_at: '2026-08-27T00:00:00Z',
      })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects delete from a helper (parent-gated)', async () => {
    const repo = makeRepo();
    const queries = { getOwned: mock(async () => closure) };
    const svc = new HouseholdClosureCommandService(
      repo as never,
      makeHouseholds('helper') as never,
      queries as never
    );

    await expect(svc.remove('helper-1', 'hh1', 'c1')).rejects.toBeInstanceOf(
      NotAHouseholdParentError
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('deletes when the caller is an owner', async () => {
    const repo = makeRepo();
    const queries = { getOwned: mock(async () => closure) };
    const svc = new HouseholdClosureCommandService(
      repo as never,
      makeHouseholds('owner') as never,
      queries as never
    );

    await svc.remove('owner-1', 'hh1', 'c1');
    expect(queries.getOwned).toHaveBeenCalledWith('owner-1', 'hh1', 'c1');
    expect(repo.delete).toHaveBeenCalledWith('c1');
  });
});
