import { describe, expect, it, mock } from 'bun:test';
import { ChildCommandService } from '../../../../../src/domains/child/services/childCommandService';
import { NotAHouseholdParentError } from '../../../../../src/domains/household/errors/householdErrors';

const child = {
  id: 'c1',
  household_id: 'h1',
  name: 'Maya',
  birth_date: null,
  colour: null,
  avatar_initial: null,
  routine_notes: null,
  archived_at: null,
  created_at: 't',
  updated_at: 't',
};

function makeRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...child,
      ...data,
      id: 'c-new',
    })),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...child,
      id,
      ...data,
    })),
    archive: mock(async (id: string) => ({
      ...child,
      id,
      archived_at: 't2',
    })),
    ...overrides,
  };
}

function makeHouseholds(
  role = 'parent',
  overrides: Record<string, unknown> = {}
): any {
  return {
    getMembership: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'u1',
      role,
    })),
    ...overrides,
  };
}

function makeQueries(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(async () => child),
    ...overrides,
  };
}

describe('ChildCommandService.create', () => {
  it('creates a child for a parent caller', async () => {
    const repo = makeRepo();
    const svc = new ChildCommandService(
      repo,
      makeHouseholds('parent'),
      makeQueries()
    );
    const result = await svc.create('u1', 'h1', { name: 'Maya' });
    expect(repo.create).toHaveBeenCalledWith({
      name: 'Maya',
      household_id: 'h1',
    });
    expect(result.id).toBe('c-new');
  });

  it('allows the owner too', async () => {
    const svc = new ChildCommandService(
      makeRepo(),
      makeHouseholds('owner'),
      makeQueries()
    );
    await expect(
      svc.create('u1', 'h1', { name: 'Maya' })
    ).resolves.toBeDefined();
  });

  it('rejects a nanny caller', async () => {
    const svc = new ChildCommandService(
      makeRepo(),
      makeHouseholds('nanny'),
      makeQueries()
    );
    await expect(
      svc.create('u1', 'h1', { name: 'Maya' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });

  it('rejects a helper caller', async () => {
    const svc = new ChildCommandService(
      makeRepo(),
      makeHouseholds('helper'),
      makeQueries()
    );
    await expect(
      svc.create('u1', 'h1', { name: 'Maya' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });
});

describe('ChildCommandService.update', () => {
  it('updates once membership + role are confirmed', async () => {
    const repo = makeRepo();
    const svc = new ChildCommandService(
      repo,
      makeHouseholds('parent'),
      makeQueries()
    );
    const result = await svc.update('u1', 'h1', 'c1', { name: 'Maya R.' });
    expect(repo.update).toHaveBeenCalledWith('c1', { name: 'Maya R.' });
    expect(result.name).toBe('Maya R.');
  });

  it('rejects a nanny caller', async () => {
    const svc = new ChildCommandService(
      makeRepo(),
      makeHouseholds('nanny'),
      makeQueries()
    );
    await expect(
      svc.update('u1', 'h1', 'c1', { name: 'Maya R.' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });
});

describe('ChildCommandService.archive', () => {
  it('soft-deletes (archives) rather than removing the row', async () => {
    const repo = makeRepo();
    const svc = new ChildCommandService(
      repo,
      makeHouseholds('owner'),
      makeQueries()
    );
    const result = await svc.archive('u1', 'h1', 'c1');
    expect(repo.archive).toHaveBeenCalledWith('c1');
    expect(result.archived_at).toBe('t2');
  });

  it('rejects a helper caller', async () => {
    const svc = new ChildCommandService(
      makeRepo(),
      makeHouseholds('helper'),
      makeQueries()
    );
    await expect(svc.archive('u1', 'h1', 'c1')).rejects.toBeInstanceOf(
      NotAHouseholdParentError
    );
  });
});
