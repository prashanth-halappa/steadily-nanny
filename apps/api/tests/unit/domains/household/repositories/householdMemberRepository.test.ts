import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { AlreadyMemberError } from '../../../../../src/domains/household/errors/householdErrors';

let HouseholdMemberRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    insert: mock(() => chain),
    order: mock(() => chain),
    maybeSingle: mock(() => Promise.resolve(finalResponse)),
    single: mock(() => Promise.resolve(finalResponse)),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: any) => Promise.resolve(finalResponse).then(resolve),
  };
  return chain;
}

/**
 * Predicate-APPLYING fake, for the two status transitions that are
 * compare-and-set: a recording-only chain would pass with the
 * `status = 'active'` / `status = 'removed'` predicate missing, which is the
 * whole point of those writes. Same shape as
 * `householdInviteRepository.test.ts`'s fake.
 */
function createCasQueryChain(rows: FakeRow[], error: unknown = null): any {
  const eqFilters: [string, unknown][] = [];
  let updatePatch: Record<string, unknown> | null = null;
  const matches = (row: FakeRow): boolean =>
    eqFilters.every(([key, value]) => row[key] === value);

  const chain: any = {
    select: mock(() => chain),
    eq: mock((key: string, value: unknown) => {
      eqFilters.push([key, value]);
      return chain;
    }),
    update: mock((patch: Record<string, unknown>) => {
      updatePatch = patch;
      return chain;
    }),
    maybeSingle: mock(async () => {
      if (error) return { data: null, error };
      const row = rows.filter(matches)[0];
      if (!row) return { data: null, error: null };
      if (updatePatch) {
        Object.assign(row, updatePatch);
      }
      return { data: { ...row }, error: null };
    }),
  };
  return chain;
}

interface FakeRow {
  [key: string]: unknown;
}

function memberRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'm1',
    household_id: 'h1',
    user_id: 'u1',
    role: 'nanny',
    can_edit: false,
    status: 'active',
    display_name_override: null,
    colour: null,
    joined_at: 't',
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createMockQueryChain()) };
    return { supabase: obj, supabaseService: obj };
  });

  const mod = await import(
    '../../../../../src/domains/household/repositories/householdMemberRepository'
  );
  HouseholdMemberRepository = mod.HouseholdMemberRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('HouseholdMemberRepository.createMembership', () => {
  it('translates a unique-constraint violation (23505) into AlreadyMemberError, not a 500', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: null,
        error: { code: '23505', message: 'duplicate key value' },
      })
    );
    const repo = new HouseholdMemberRepository();
    await expect(
      repo.createMembership({
        household_id: 'h1',
        user_id: 'u1',
        role: 'nanny',
      })
    ).rejects.toBeInstanceOf(AlreadyMemberError);
  });

  it('returns the created row on success', async () => {
    const created = {
      id: 'm1',
      household_id: 'h1',
      user_id: 'u1',
      role: 'nanny',
    };
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: created, error: null })
    );
    const repo = new HouseholdMemberRepository();
    const result = await repo.createMembership({
      household_id: 'h1',
      user_id: 'u1',
      role: 'nanny',
    });
    expect(result).toEqual(created);
  });
});

describe('HouseholdMemberRepository.findMembershipAnyStatus', () => {
  it('filters on household and user only — a removed row must still be found', async () => {
    const removed = {
      id: 'm1',
      household_id: 'h1',
      user_id: 'u1',
      role: 'nanny',
      status: 'removed',
    };
    const chain = createMockQueryChain({ data: removed, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new HouseholdMemberRepository();

    const result = await repo.findMembershipAnyStatus('h1', 'u1');

    expect(result).toEqual(removed);
    expect(chain.eq.mock.calls).toEqual([
      ['household_id', 'h1'],
      ['user_id', 'u1'],
    ]);
  });

  it('returns null when the user has never been a member', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new HouseholdMemberRepository();
    expect(await repo.findMembershipAnyStatus('h1', 'u1')).toBeNull();
  });
});

describe('HouseholdMemberRepository.removeMembership', () => {
  it('flips an active membership to removed and returns the updated row', async () => {
    const row = memberRow();
    mockSupabaseService.from.mockImplementation(() =>
      createCasQueryChain([row])
    );
    const repo = new HouseholdMemberRepository();

    const result = await repo.removeMembership('m1');

    expect(result).toMatchObject({ id: 'm1', status: 'removed' });
    expect(row.status).toBe('removed');
  });

  it('returns null when the membership is already removed — the CAS predicate', async () => {
    // Two parents tapping remove at once, or a retry after a timeout: the
    // second write must match zero rows so the service can 404 rather than
    // report a second successful removal.
    const row = memberRow({ status: 'removed' });
    mockSupabaseService.from.mockImplementation(() =>
      createCasQueryChain([row])
    );
    const repo = new HouseholdMemberRepository();

    expect(await repo.removeMembership('m1')).toBeNull();
  });

  it('throws a DatabaseError when the update fails', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createCasQueryChain([memberRow()], { message: 'boom' })
    );
    const repo = new HouseholdMemberRepository();
    await expect(repo.removeMembership('m1')).rejects.toThrow(
      'Failed to remove household member'
    );
  });
});

describe('HouseholdMemberRepository.reactivateMembership', () => {
  it('flips a removed membership back to active with the invite role and can_edit false', async () => {
    // can_edit is deliberately reset: a returning member starts from the same
    // baseline a fresh redeem produces, never the rights they had before.
    const row = memberRow({ status: 'removed', role: 'nanny', can_edit: true });
    mockSupabaseService.from.mockImplementation(() =>
      createCasQueryChain([row])
    );
    const repo = new HouseholdMemberRepository();

    const result = await repo.reactivateMembership('m1', 'parent');

    expect(result).toMatchObject({
      id: 'm1',
      status: 'active',
      role: 'parent',
      can_edit: false,
    });
  });

  it('returns null when the membership is not removed — the CAS predicate', async () => {
    const row = memberRow({ status: 'active' });
    mockSupabaseService.from.mockImplementation(() =>
      createCasQueryChain([row])
    );
    const repo = new HouseholdMemberRepository();

    expect(await repo.reactivateMembership('m1', 'nanny')).toBeNull();
    expect(row.role).toBe('nanny');
  });

  it('throws a DatabaseError when the update fails', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createCasQueryChain([memberRow({ status: 'removed' })], {
        message: 'boom',
      })
    );
    const repo = new HouseholdMemberRepository();
    await expect(repo.reactivateMembership('m1', 'nanny')).rejects.toThrow(
      'Failed to reactivate household member'
    );
  });
});

describe('HouseholdMemberRepository.listActiveByUser', () => {
  it('returns every active membership row for the user, across households', async () => {
    const rows = [
      { id: 'm1', household_id: 'h1', user_id: 'u1', role: 'owner' },
      { id: 'm2', household_id: 'h2', user_id: 'u1', role: 'nanny' },
    ];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new HouseholdMemberRepository();
    const result = await repo.listActiveByUser('u1');
    expect(result).toEqual(rows);
  });

  it('returns [] when the user has no active memberships', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new HouseholdMemberRepository();
    expect(await repo.listActiveByUser('u1')).toEqual([]);
  });
});

describe('HouseholdMemberRepository.listActiveByHousehold', () => {
  // Two nannies with no `display_name_override` were indistinguishable on
  // every member surface, because `household_members` has no name column and
  // the payload offered nothing to fall back on but the role label.
  it('joins the profile name onto each row as profile_name', async () => {
    const rows = [
      {
        id: 'm1',
        household_id: 'h1',
        user_id: 'u1',
        role: 'nanny',
        user_profiles: { name: 'Amara' },
      },
      {
        id: 'm2',
        household_id: 'h1',
        user_id: 'u2',
        role: 'nanny',
        user_profiles: { name: 'Bea' },
      },
    ];
    let selectArg = '';
    mockSupabaseService.from.mockImplementation(() => {
      const chain = createMockQueryChain({ data: rows, error: null });
      chain.select = mock((arg: string) => {
        selectArg = arg;
        return chain;
      });
      return chain;
    });
    const repo = new HouseholdMemberRepository();
    const result = await repo.listActiveByHousehold('h1');

    expect(selectArg).toContain('user_profiles');
    expect(result.map((row: any) => row.profile_name)).toEqual([
      'Amara',
      'Bea',
    ]);
    // The nested embed is an implementation detail of the join, not wire shape.
    expect(result[0]).not.toHaveProperty('user_profiles');
  });

  it('leaves profile_name null when the member has no profile row', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: [{ id: 'm1', household_id: 'h1', user_id: 'u1', role: 'nanny' }],
        error: null,
      })
    );
    const repo = new HouseholdMemberRepository();
    const result = await repo.listActiveByHousehold('h1');
    expect(result[0].profile_name).toBeNull();
  });
});
