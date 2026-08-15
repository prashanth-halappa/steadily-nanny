import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * `HouseholdInviteRepository` runs against a fake PostgREST chain that actually
 * APPLIES the eq() predicates to an in-memory row set, exactly like
 * `expenseRepository.test.ts`. That matters here: `claimPending` is what makes
 * an invite code single-use, and a recording-only chain would happily pass
 * with the `status = 'pending'` predicate missing — which is precisely the bug
 * these tests exist to catch.
 */

interface FakeRow {
  [key: string]: unknown;
}

let HouseholdInviteRepository: any;
let mockSupabaseService: any;
let lastChain: any;

function createFakeQuery(rows: FakeRow[], error: unknown = null): any {
  const eqFilters: [string, unknown][] = [];
  let updatePatch: Record<string, unknown> | null = null;
  let insertedRow: Record<string, unknown> | null = null;

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
    // `create` is inherited from `BaseRepository`, which hands the whole
    // object to `.insert()` and reads the row back through `.single()`. The
    // echo below is what makes a round-trip assertion mean something: a
    // column dropped on the way in is a column missing on the way out.
    insert: mock((row: Record<string, unknown>) => {
      insertedRow = row;
      return chain;
    }),
    single: mock(async () => {
      if (error) return { data: null, error };
      return { data: { id: 'i-new', ...insertedRow }, error: null };
    }),
    maybeSingle: mock(async () => {
      if (error) return { data: null, error };
      const row = rows.filter(matches)[0];
      if (!row) return { data: null, error: null };
      return {
        data: updatePatch ? { ...row, ...updatePatch } : row,
        error: null,
      };
    }),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(
        error
          ? { data: null, error }
          : { data: rows.filter(matches), error: null }
      ).then(resolve),
  };
  lastChain = chain;
  return chain;
}

function invite(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'i1',
    household_id: 'h1',
    code: 'ABC-234',
    email: null,
    role: 'nanny',
    invited_by: 'u1',
    expires_at: '2999-01-01T00:00:00Z',
    status: 'pending',
    accepted_by: null,
    accepted_at: null,
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

function withRows(rows: FakeRow[], error: unknown = null): void {
  mockSupabaseService.from.mockImplementation(() =>
    createFakeQuery(rows, error)
  );
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createFakeQuery([])) };
    return { supabase: obj, supabaseService: obj };
  });

  const mod = await import(
    '../../../../../src/domains/household/repositories/householdInviteRepository'
  );
  HouseholdInviteRepository = mod.HouseholdInviteRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('HouseholdInviteRepository.findByCode', () => {
  it('returns the invite whose code matches', async () => {
    withRows([
      invite({ code: 'ABC-234' }),
      invite({ id: 'i2', code: 'ZZZ-999' }),
    ]);
    const repo = new HouseholdInviteRepository();
    const found = await repo.findByCode('ABC-234');
    expect(found).toMatchObject({ id: 'i1' });
  });

  it('returns null for an unknown code', async () => {
    withRows([invite({ code: 'ABC-234' })]);
    const repo = new HouseholdInviteRepository();
    expect(await repo.findByCode('QQQ-111')).toBeNull();
  });
});

describe('HouseholdInviteRepository.claimPending', () => {
  it('accepts a pending invite and returns the claimed row', async () => {
    withRows([invite()]);
    const repo = new HouseholdInviteRepository();
    const claimed = await repo.claimPending('i1', 'u2');
    expect(claimed).toMatchObject({
      id: 'i1',
      status: 'accepted',
      accepted_by: 'u2',
    });
    expect(typeof claimed.accepted_at).toBe('string');
  });

  it('returns null when the invite is no longer pending — the CAS predicate', async () => {
    // The racer that arrives second must come away with nothing. Without the
    // `status = 'pending'` predicate on the update, this row is still matched
    // by id alone and the second redeemer wins a membership too.
    withRows([invite({ status: 'accepted', accepted_by: 'u2' })]);
    const repo = new HouseholdInviteRepository();
    expect(await repo.claimPending('i1', 'u3')).toBeNull();
  });

  it('returns null when the invite was revoked', async () => {
    withRows([invite({ status: 'revoked' })]);
    const repo = new HouseholdInviteRepository();
    expect(await repo.claimPending('i1', 'u2')).toBeNull();
  });

  it('throws a DatabaseError when the update fails', async () => {
    withRows([invite()], { message: 'boom' });
    const repo = new HouseholdInviteRepository();
    await expect(repo.claimPending('i1', 'u2')).rejects.toThrow(
      'Failed to claim invite'
    );
  });
});

describe('HouseholdInviteRepository.revokePending', () => {
  it('flips a pending invite to revoked and returns the updated row', async () => {
    withRows([invite()]);
    const repo = new HouseholdInviteRepository();

    const revoked = await repo.revokePending('i1', 'h1');

    expect(revoked).toMatchObject({ id: 'i1', status: 'revoked' });
  });

  it('returns null for an invite belonging to ANOTHER household', async () => {
    // household_id is inside the CAS, not checked after the fact: a parent of
    // household A guessing an id from household B must read as not-found, not
    // revoke someone else's invite.
    withRows([invite({ household_id: 'h-other' })]);
    const repo = new HouseholdInviteRepository();

    expect(await repo.revokePending('i1', 'h1')).toBeNull();
  });

  it('returns null when the invite is no longer pending — the CAS predicate', async () => {
    withRows([invite({ status: 'accepted', accepted_by: 'u2' })]);
    const repo = new HouseholdInviteRepository();

    expect(await repo.revokePending('i1', 'h1')).toBeNull();
  });

  it('throws a DatabaseError when the update fails', async () => {
    withRows([invite()], { message: 'boom' });
    const repo = new HouseholdInviteRepository();
    await expect(repo.revokePending('i1', 'h1')).rejects.toThrow(
      'Failed to revoke invite'
    );
  });
});

describe('HouseholdInviteRepository.releaseClaim', () => {
  it('puts an invite this user claimed back to pending', async () => {
    const rows = [invite({ status: 'accepted', accepted_by: 'u2' })];
    withRows(rows);
    const repo = new HouseholdInviteRepository();

    await repo.releaseClaim('i1', 'u2');

    const chain = lastChain;
    expect(chain.update).toHaveBeenCalledWith({
      status: 'pending',
      accepted_by: null,
      accepted_at: null,
    });
    expect(chain.eq).toHaveBeenCalledWith('id', 'i1');
    // Both predicates matter: without them a release could un-claim the row
    // that a DIFFERENT racer legitimately won.
    expect(chain.eq).toHaveBeenCalledWith('status', 'accepted');
    expect(chain.eq).toHaveBeenCalledWith('accepted_by', 'u2');
  });

  it('releases nothing once the claim has been re-taken — the accepted_at predicate', async () => {
    // Same id, same claimer, different claim. Without `accepted_at` in the CAS
    // a caller holding a stale snapshot un-claims the FRESH claim and puts a
    // consumed single-use code back into circulation.
    const row = invite({
      status: 'accepted',
      accepted_by: 'u2',
      accepted_at: '2026-08-06T10:00:00Z',
    });
    withRows([row]);
    const repo = new HouseholdInviteRepository();

    await repo.releaseClaim('i1', 'u2', '2026-08-06T09:00:00Z');

    const chain = lastChain;
    expect(chain.eq).toHaveBeenCalledWith(
      'accepted_at',
      '2026-08-06T09:00:00Z'
    );
    expect(row.status).toBe('accepted');
  });

  it('throws a DatabaseError when the release fails', async () => {
    withRows([invite({ status: 'accepted', accepted_by: 'u2' })], {
      message: 'boom',
    });
    const repo = new HouseholdInviteRepository();
    await expect(repo.releaseClaim('i1', 'u2')).rejects.toThrow(
      'Failed to release invite claim'
    );
  });
});

/**
 * P8 — the parent's pay offer (098) rides the invite row itself. `create` is
 * inherited from `BaseRepository` and every read here selects `*`, so the
 * column travels for free TODAY. This test exists to keep it that way: the
 * failure mode it guards is somebody later narrowing the insert to a field
 * list or the select to named columns, at which point the offer silently
 * stops reaching redemption and a nanny joins to no proposal, with nothing
 * else in the suite going red.
 */
describe('HouseholdInviteRepository — the pay offer (P8)', () => {
  const offer = { rate_minor: 2800, valid_from: '2026-09-01' };

  it('round-trips pay_offer through create', async () => {
    withRows([]);
    const repo = new HouseholdInviteRepository();
    const created = await repo.create({
      household_id: 'h1',
      code: 'ABC-234',
      role: 'nanny',
      invited_by: 'u1',
      pay_offer: offer,
    });

    expect(lastChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ pay_offer: offer })
    );
    expect(created.pay_offer).toEqual(offer);
  });

  it('writes an explicit null when there is no offer — absent is not "unset"', async () => {
    withRows([]);
    const repo = new HouseholdInviteRepository();
    const created = await repo.create({
      household_id: 'h1',
      code: 'ABC-234',
      role: 'parent',
      invited_by: 'u1',
      pay_offer: null,
    });

    expect(created.pay_offer).toBeNull();
  });

  it('reads the offer back off a stored row', async () => {
    withRows([invite({ pay_offer: offer })]);
    const repo = new HouseholdInviteRepository();
    const found = await repo.findByCode('ABC-234');
    expect(found?.pay_offer).toEqual(offer);
  });
});
