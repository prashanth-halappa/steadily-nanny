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

const liveHousehold = {
  id: 'h1',
  name: 'The Ahmeds',
  state: 'live',
  created_by: 'u-parent',
};

/** Marisol's own draft: no owner, no name, created by the nanny caller. */
const draftHousehold = {
  id: 'h1',
  name: null,
  state: 'draft',
  created_by: 'u1',
};

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
    // Only read once the role gate has failed — the §2.2 draft-author
    // capability is the sole thing that can rescue a nanny caller.
    getOwned: mock(async () => liveHousehold),
    ...overrides,
  };
}

/** A nanny writing children into the draft she herself authored (§2.2). */
function makeDraftAuthorHouseholds(): any {
  return makeHouseholds('nanny', {
    getOwned: mock(async () => draftHousehold),
  });
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

describe('ChildCommandService — the §2.2 draft-author capability', () => {
  // She adds the children she will actually be caring for while she authors
  // her terms; there is no parent in a draft to do it for her. The same nanny
  // in a LIVE household is refused by the tests above, unchanged.
  it('lets the draft author create a child in her own draft', async () => {
    const repo = makeRepo();
    const svc = new ChildCommandService(
      repo,
      makeDraftAuthorHouseholds(),
      makeQueries()
    );

    await expect(
      svc.create('u1', 'h1', { name: 'Ayla' })
    ).resolves.toBeDefined();
    expect(repo.create).toHaveBeenCalledWith({
      name: 'Ayla',
      household_id: 'h1',
    });
  });

  it('lets her update and archive one too — children CRUD is in the grant', async () => {
    const svc = new ChildCommandService(
      makeRepo(),
      makeDraftAuthorHouseholds(),
      makeQueries()
    );

    await expect(
      svc.update('u1', 'h1', 'c1', { name: 'Ayla R.' })
    ).resolves.toBeDefined();
    await expect(svc.archive('u1', 'h1', 'c1')).resolves.toBeDefined();
  });

  it('refuses a nanny who is NOT the author, in the same draft', async () => {
    const svc = new ChildCommandService(
      makeRepo(),
      makeHouseholds('nanny', {
        getOwned: mock(async () => ({
          ...draftHousehold,
          created_by: 'u-someone-else',
        })),
      }),
      makeQueries()
    );

    await expect(
      svc.create('u1', 'h1', { name: 'Ayla' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
  });
});
