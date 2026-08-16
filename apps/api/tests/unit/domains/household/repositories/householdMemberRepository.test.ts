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
    in: mock(() => chain),
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
  const inFilters: [string, unknown[]][] = [];
  let updatePatch: Record<string, unknown> | null = null;
  const matches = (row: FakeRow): boolean =>
    eqFilters.every(([key, value]) => row[key] === value) &&
    inFilters.every(([key, values]) => values.includes(row[key]));

  const chain: any = {
    select: mock(() => chain),
    eq: mock((key: string, value: unknown) => {
      eqFilters.push([key, value]);
      return chain;
    }),
    in: mock((key: string, values: unknown[]) => {
      inFilters.push([key, values]);
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
  it('filters on household and user, and a removed row must still be found', async () => {
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

  // D-49. Six money-read gates branch on ROLE ONLY from this lookup's result
  // (`assertPayrollReader`, `assertPaymentReader`, and their expense, pay-terms,
  // settlement and PTO twins), so whatever this query admits reads money. When
  // "any status" meant `{active, removed}` that was correct; `candidate` makes
  // it a disclosure. The filter must be POSITIVE — a `neq('status','removed')`
  // would pass this test's sibling below and silently admit her.
  it('applies a positive status filter of exactly [active, removed] — a candidate is invisible here', async () => {
    const chain = createMockQueryChain({ data: null, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new HouseholdMemberRepository();

    await repo.findMembershipAnyStatus('h1', 'u1');

    expect(chain.in.mock.calls).toEqual([['status', ['active', 'removed']]]);
  });

  it('returns null when the user has never been a member', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new HouseholdMemberRepository();
    expect(await repo.findMembershipAnyStatus('h1', 'u1')).toBeNull();
  });
});

describe('HouseholdMemberRepository.findMembershipIncludingCandidate', () => {
  // The two callers that genuinely mean EVERY row: `redeemInvite`'s pre-check
  // (the unique (household_id, user_id) index makes a fresh insert impossible
  // whatever the status, so a no-op must refuse before it burns the code) and
  // the stranded-claim self-heal (a candidate row means the redeem DID land).
  it('applies no status filter at all, so a candidate row is returned', async () => {
    const candidate = {
      id: 'm1',
      household_id: 'h1',
      user_id: 'u1',
      role: 'nanny',
      status: 'candidate',
    };
    const chain = createMockQueryChain({ data: candidate, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new HouseholdMemberRepository();

    expect(await repo.findMembershipIncludingCandidate('h1', 'u1')).toEqual(
      candidate
    );
    expect(chain.eq.mock.calls).toEqual([
      ['household_id', 'h1'],
      ['user_id', 'u1'],
    ]);
    expect(chain.in.mock.calls).toEqual([]);
  });

  it('throws a DatabaseError when the query fails', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new HouseholdMemberRepository();
    await expect(
      repo.findMembershipIncludingCandidate('h1', 'u1')
    ).rejects.toThrow('Failed to look up household membership');
  });
});

describe('HouseholdMemberRepository.activateCandidate', () => {
  // The acceptance transition (§8.2.1): `reactivateMembership` CASes on
  // `status='removed'` and `removeMembership` on `status='active'`, so a
  // candidate row matched neither and had no way out of the state.
  it('flips a candidate to active and returns the updated row', async () => {
    const row = memberRow({ status: 'candidate', role: 'nanny' });
    mockSupabaseService.from.mockImplementation(() =>
      createCasQueryChain([row])
    );
    const repo = new HouseholdMemberRepository();

    const result = await repo.activateCandidate('m1');

    expect(result).toMatchObject({ id: 'm1', status: 'active' });
    expect(row.status).toBe('active');
  });

  it('returns null when the row is not a candidate — the CAS predicate', async () => {
    // A second acceptance, or a row a parent removed while he was deciding.
    const row = memberRow({ status: 'active' });
    mockSupabaseService.from.mockImplementation(() =>
      createCasQueryChain([row])
    );
    const repo = new HouseholdMemberRepository();

    expect(await repo.activateCandidate('m1')).toBeNull();
  });

  it('throws a DatabaseError when the update fails', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createCasQueryChain([memberRow({ status: 'candidate' })], {
        message: 'boom',
      })
    );
    const repo = new HouseholdMemberRepository();
    await expect(repo.activateCandidate('m1')).rejects.toThrow(
      'Failed to activate household candidate'
    );
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

  // Declining is a removal: the parent read her terms and said no, and the row
  // has to have somewhere to go. Widened to a two-value positive set rather
  // than dropped — `removed` still matches neither, so the double-remove
  // no-op above keeps working.
  it('flips a CANDIDATE to removed too — declining is how that window ends', async () => {
    const row = memberRow({ status: 'candidate' });
    mockSupabaseService.from.mockImplementation(() =>
      createCasQueryChain([row])
    );
    const repo = new HouseholdMemberRepository();

    expect(await repo.removeMembership('m1')).toMatchObject({
      status: 'removed',
    });
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

describe('HouseholdMemberRepository.listByUser', () => {
  // The active-only sibling above is what `listMembershipsForUser` used to
  // call, and it is why the mobile app's `isPastMember` was always false: a
  // `removed` row could never reach the client, so the read-only gate the
  // past-households feature is built on had nothing to switch on. This query
  // must NOT filter on status.
  it('returns removed rows alongside active ones and applies NO status filter', async () => {
    const rows = [
      { id: 'm1', household_id: 'h1', user_id: 'u1', status: 'active' },
      { id: 'm2', household_id: 'h2', user_id: 'u1', status: 'removed' },
    ];
    let chain: any;
    mockSupabaseService.from.mockImplementation(() => {
      chain = createMockQueryChain({ data: rows, error: null });
      return chain;
    });
    const repo = new HouseholdMemberRepository();

    expect(await repo.listByUser('u1')).toEqual(rows);
    const eqKeys = chain.eq.mock.calls.map((call: unknown[]) => call[0]);
    expect(eqKeys).toEqual(['user_id']);
  });

  it('returns [] when the user has no memberships at all', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new HouseholdMemberRepository();
    expect(await repo.listByUser('u1')).toEqual([]);
  });
});

describe('HouseholdMemberRepository.listRemovedHouseholdIds', () => {
  // A removed nanny is still owed the hours she worked. If this query is not
  // pinned to status='removed' it silently returns the active households too
  // and the picker shows a household she can no longer act in as if she can.
  it('filters on the user and status=removed, and returns only the ids', async () => {
    let chain: any;
    mockSupabaseService.from.mockImplementation(() => {
      chain = createMockQueryChain({
        data: [{ household_id: 'h9' }, { household_id: 'h8' }],
        error: null,
      });
      return chain;
    });
    const repo = new HouseholdMemberRepository();
    expect(await repo.listRemovedHouseholdIds('u1')).toEqual(['h9', 'h8']);
    expect(chain.eq.mock.calls).toEqual([
      ['user_id', 'u1'],
      ['status', 'removed'],
    ]);
  });

  it('returns [] when the user has never been removed from anything', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new HouseholdMemberRepository();
    expect(await repo.listRemovedHouseholdIds('u1')).toEqual([]);
  });

  it('throws a DatabaseError when the query fails', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new HouseholdMemberRepository();
    await expect(repo.listRemovedHouseholdIds('u1')).rejects.toThrow(
      'Failed to list households for user'
    );
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

  // Pin the separation from `listNonRemovedByHousehold`: push audiences and
  // shift authorization must never widen to candidates via a quiet refactor.
  it('filters on status = active only — a candidate row is excluded at the query', async () => {
    const chain = createMockQueryChain({ data: [], error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new HouseholdMemberRepository();

    await repo.listActiveByHousehold('h1');

    expect(chain.eq.mock.calls).toContainEqual(['status', 'active']);
    expect(chain.in.mock.calls).toEqual([]);
  });
});

describe('HouseholdMemberRepository.listNonRemovedByHousehold', () => {
  // `GET /v1/households/:id/members` is the one read the mobile inbox fans
  // proposal queries from; D-38 leaves the nanny a `candidate` until acceptance.
  it('filters on status in [active, candidate] — never a negated removed test', async () => {
    const chain = createMockQueryChain({ data: [], error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new HouseholdMemberRepository();

    await repo.listNonRemovedByHousehold('h1');

    expect(chain.in.mock.calls).toEqual([['status', ['active', 'candidate']]]);
    expect(
      chain.eq.mock.calls.filter((call: unknown[]) => call[0] === 'status')
    ).toEqual([]);
  });

  it('joins the profile name onto each row as profile_name', async () => {
    const rows = [
      {
        id: 'm1',
        household_id: 'h1',
        user_id: 'u1',
        role: 'nanny',
        status: 'candidate',
        user_profiles: { name: 'Amara' },
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
    const result = await repo.listNonRemovedByHousehold('h1');

    expect(selectArg).toContain('user_profiles');
    expect(result[0].profile_name).toBe('Amara');
    expect(result[0].status).toBe('candidate');
  });

  // 099. The phone rides the SAME embed as the name — `user_profiles` RLS is
  // untouched and stays owner-only, so this join is the only route a
  // co-member's number ever takes out of the database. The repository returns
  // it raw for every non-removed row; whose number actually goes on the wire
  // is `householdQueryService.listMembers`' decision, not this one's.
  it('joins the profile phone onto each row as profile_phone', async () => {
    const rows = [
      {
        id: 'm1',
        household_id: 'h1',
        user_id: 'u1',
        role: 'parent',
        status: 'active',
        user_profiles: { name: 'Amara', phone: '07700 900123' },
      },
      {
        id: 'm2',
        household_id: 'h1',
        user_id: 'u2',
        role: 'nanny',
        status: 'active',
        user_profiles: { name: 'Bea', phone: null },
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
    const result = await repo.listNonRemovedByHousehold('h1');

    expect(selectArg).toContain('user_profiles(name, phone)');
    expect(result[0].profile_phone).toBe('07700 900123');
    // A member who never gave a number is null, not undefined — the roster
    // says "no number" rather than "field missing".
    expect(result[1].profile_phone).toBeNull();
  });

  it('is null when the profile row itself is gone', async () => {
    const rows = [
      {
        id: 'm1',
        household_id: 'h1',
        user_id: 'u1',
        role: 'parent',
        status: 'active',
        user_profiles: null,
      },
    ];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new HouseholdMemberRepository();
    const result = await repo.listNonRemovedByHousehold('h1');
    expect(result[0].profile_phone).toBeNull();
  });
});
