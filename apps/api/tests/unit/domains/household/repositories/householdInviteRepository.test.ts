/**
 * `HouseholdInviteRepository` on a real D1 (tests/helpers/testDb.ts).
 *
 * Real predicates, not a recording mock: `claimPending` and the draft
 * redemption are what make an invite code single-use, and only rows that do or
 * do not change prove the `status = 'pending'` CAS is there.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import type { HouseholdInviteRepository as Repo } from '../../../../../src/domains/household/repositories/householdInviteRepository';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let t: TestDb;
let repo: Repo;

const run = (sql: string, ...binds: unknown[]) =>
  t.d1
    .prepare(sql)
    .bind(...binds)
    .run();
const all = async <T>(sql: string, ...binds: unknown[]): Promise<T[]> =>
  (
    await t.d1
      .prepare(sql)
      .bind(...binds)
      .all()
  ).results as T[];

async function person(id: string) {
  await run(
    'INSERT INTO user (id, name, email) VALUES (?, ?, ?)',
    id,
    id,
    `${id}@x.test`
  );
  await run('INSERT INTO user_profiles (user_id, name) VALUES (?, ?)', id, id);
}

async function household(id: string, state = 'live', createdBy?: string) {
  await run(
    'INSERT INTO households (id, name, state, created_by, week_starts_on) VALUES (?, ?, ?, ?, 1)',
    id,
    `H ${id}`,
    state,
    createdBy ?? null
  );
}

async function member(
  household: string,
  user: string,
  role: string,
  status = 'active'
) {
  await run(
    'INSERT INTO household_members (id, household_id, user_id, role, status) VALUES (?, ?, ?, ?, ?)',
    crypto.randomUUID(),
    household,
    user,
    role,
    status
  );
}

async function invite(
  o: {
    id?: string;
    household?: string;
    code?: string;
    status?: string;
    expires_at?: string;
    accepted_by?: string | null;
    accepted_at?: string | null;
  } = {}
) {
  await run(
    'INSERT INTO household_invites (id, household_id, code, role, invited_by, status, expires_at, accepted_by, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    o.id ?? 'i1',
    o.household ?? 'h1',
    o.code ?? 'ABC-234',
    'nanny',
    'u1',
    o.status ?? 'pending',
    o.expires_at ?? '2999-01-01T00:00:00.000Z',
    o.accepted_by ?? null,
    o.accepted_at ?? null
  );
}

const inviteRow = async (id = 'i1') =>
  (
    await all<{
      status: string;
      accepted_by: string | null;
      accepted_at: string | null;
    }>('SELECT * FROM household_invites WHERE id = ?', id)
  )[0];

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const mod = await import(
    '../../../../../src/domains/household/repositories/householdInviteRepository'
  );
  repo = new mod.HouseholdInviteRepository();
});

afterAll(() => t.dispose());

beforeEach(async () => {
  for (const table of [
    'terms_proposals',
    'children',
    'household_invites',
    'household_members',
    'households',
    'user_profiles',
    'user',
  ]) {
    await run(`DELETE FROM ${table}`);
  }
  for (const u of ['u1', 'u2', 'u3']) await person(u);
  await household('h1');
});

describe('HouseholdInviteRepository.findByCode', () => {
  it('normalises the code before looking it up', async () => {
    await invite();
    expect((await repo.findByCode('abc 234'))?.id).toBe('i1');
    expect(await repo.findByCode('ZZZ-999')).toBeNull();
  });
});

describe('HouseholdInviteRepository.claimPending', () => {
  it('claims a pending invite exactly once', async () => {
    await invite();
    const first = await repo.claimPending('i1', 'u2');
    expect(first?.status).toBe('accepted');
    expect(first?.accepted_by).toBe('u2');
    expect(await repo.claimPending('i1', 'u3')).toBeNull();
    expect((await inviteRow())?.accepted_by).toBe('u2');
  });
});

describe('HouseholdInviteRepository.revokePending', () => {
  it("never revokes another family's invite", async () => {
    await household('h2');
    await invite();
    expect(await repo.revokePending('i1', 'h2')).toBeNull();
    expect((await repo.revokePending('i1', 'h1'))?.status).toBe('revoked');
  });
});

describe('HouseholdInviteRepository.releaseClaim', () => {
  it('puts an invite this user claimed back to pending', async () => {
    await invite({
      status: 'accepted',
      accepted_by: 'u2',
      accepted_at: '2026-08-06T10:00:00.000Z',
    });
    await repo.releaseClaim('i1', 'u2', '2026-08-06T10:00:00.000Z');
    expect(await inviteRow()).toMatchObject({
      status: 'pending',
      accepted_by: null,
      accepted_at: null,
    });
  });

  it('releases nothing once the claim has been re-taken — the accepted_at predicate', async () => {
    await invite({
      status: 'accepted',
      accepted_by: 'u2',
      accepted_at: '2026-08-06T10:00:00.000Z',
    });
    await repo.releaseClaim('i1', 'u2', '2026-08-06T09:00:00.000Z');
    expect((await inviteRow())?.status).toBe('accepted');
  });
});

describe('HouseholdInviteRepository.stampOpened', () => {
  it('stamps only the first open', async () => {
    await invite();
    await repo.stampOpened('ABC-234');
    const [first] = await all<{ opened_at: string }>(
      'SELECT opened_at FROM household_invites'
    );
    await repo.stampOpened('ABC-234');
    const [second] = await all<{ opened_at: string }>(
      'SELECT opened_at FROM household_invites'
    );
    expect(first?.opened_at).toBeTruthy();
    expect(second?.opened_at).toBe(first?.opened_at);
  });
});

/**
 * P8 — the parent's pay offer rides the invite row itself. Guards somebody
 * later narrowing the insert or select to named columns.
 */
describe('HouseholdInviteRepository — the pay offer (P8)', () => {
  // Partial on purpose: the column stores whatever JSON the offer carries.
  const offer = { rate_minor: 2800, valid_from: '2026-09-01' } as any;

  it('round-trips pay_offer through create and findByCode', async () => {
    const created = await repo.create({
      household_id: 'h1',
      code: 'ABC-234',
      role: 'nanny',
      invited_by: 'u1',
      pay_offer: offer,
    });
    expect(created.pay_offer).toEqual(offer);
    expect((await repo.findByCode('ABC-234'))?.pay_offer).toEqual(offer);
  });

  it('writes an explicit null when there is no offer', async () => {
    const created = await repo.create({
      household_id: 'h1',
      code: 'ABC-234',
      role: 'parent',
      invited_by: 'u1',
      pay_offer: null,
    });
    expect(created.pay_offer).toBeNull();
  });
});

/**
 * Port of 094 `redeem_draft_household_invite` (MIGRATION-NOTES §5.9).
 * u1 = the nanny who authored draft `d1`; u2 = the redeeming parent.
 */
describe('HouseholdInviteRepository.redeemDraftHousehold', () => {
  beforeEach(async () => {
    await household('d1', 'draft', 'u1');
    await member('d1', 'u1', 'nanny');
    await invite({ household: 'd1' });
  });

  const memberships = (household: string) =>
    all<{ user_id: string; role: string; status: string }>(
      'SELECT user_id, role, status FROM household_members WHERE household_id = ? ORDER BY role',
      household
    );

  it('instantiates a live household with both members, children and the proposal', async () => {
    await run(
      "INSERT INTO children (id, household_id, name) VALUES ('c1', 'd1', 'Ada')"
    );
    await run(
      "INSERT INTO children (id, household_id, name, archived_at) VALUES ('c2', 'd1', 'Old', '2026-01-01T00:00:00.000Z')"
    );
    await run(
      `INSERT INTO terms_proposals (id, household_id, carer_id, proposed_by, direction, terms, carer_display_name)
       VALUES ('p1', 'd1', 'u1', 'u1', 'carer', '{"rate_minor":2500}', 'Nan')`
    );

    const r = await repo.redeemDraftHousehold('abc-234', 'u2', null, 0);
    if (r.outcome !== 'redeemed') throw new Error(r.outcome);
    expect(r.instantiated).toBe(true);
    expect(r.draft_household_id).toBe('d1');
    expect(r.carer_id).toBe('u1');
    expect(r.membership).toMatchObject({
      user_id: 'u1',
      role: 'nanny',
      status: 'active',
      can_edit: false,
    });

    const [h] = await all<{ state: string; week_starts_on: number }>(
      'SELECT * FROM households WHERE id = ?',
      r.household_id
    );
    expect(h).toMatchObject({ state: 'live', week_starts_on: 0 });
    expect(await memberships(r.household_id)).toEqual([
      { user_id: 'u1', role: 'nanny', status: 'active' },
      { user_id: 'u2', role: 'owner', status: 'active' },
    ]);
    const kids = await all<{ name: string }>(
      'SELECT name FROM children WHERE household_id = ?',
      r.household_id
    );
    expect(kids.map(k => k.name)).toEqual(['Ada']);
    const [p] = await all<{
      id: string;
      terms: string;
      from_invite_id: string;
    }>('SELECT * FROM terms_proposals WHERE household_id = ?', r.household_id);
    expect(p?.id).toBe(r.proposal?.id ?? '');
    expect(JSON.parse(p?.terms ?? '{}')).toEqual({ rate_minor: 2500 });
    expect(p?.from_invite_id).toBe('i1');
    expect((await inviteRow())?.status).toBe('accepted');
  });

  it('absorbs into a live household as a candidate when the redeemer is a parent', async () => {
    await member('h1', 'u2', 'parent');
    const r = await repo.redeemDraftHousehold('ABC-234', 'u2', 'h1', 0);
    expect(r).toMatchObject({
      outcome: 'redeemed',
      instantiated: false,
      household_id: 'h1',
      proposal: null,
    });
    expect(await memberships('h1')).toContainEqual({
      user_id: 'u1',
      role: 'nanny',
      status: 'candidate',
    });
  });

  it('refuses a target the redeemer does not parent', async () => {
    await member('h1', 'u2', 'nanny');
    expect(
      await repo.redeemDraftHousehold('ABC-234', 'u2', 'h1', null)
    ).toEqual({ outcome: 'target_not_permitted' });
    expect((await inviteRow())?.status).toBe('pending');
  });

  it('answers already_member before claiming the code', async () => {
    await member('h1', 'u2', 'owner');
    await member('h1', 'u1', 'nanny', 'removed');
    expect(
      await repo.redeemDraftHousehold('ABC-234', 'u2', 'h1', null)
    ).toEqual({
      outcome: 'already_member',
      household_id: 'h1',
      status: 'removed',
    });
    expect((await inviteRow())?.status).toBe('pending');
  });

  it('rolls everything back when the target already has her open proposal', async () => {
    await member('h1', 'u2', 'owner');
    for (const [id, hh] of [
      ['p1', 'd1'],
      ['p2', 'h1'],
    ]) {
      await run(
        `INSERT INTO terms_proposals (id, household_id, carer_id, proposed_by, direction, terms, carer_display_name)
         VALUES (?, ?, 'u1', 'u1', 'carer', '{}', 'Nan')`,
        id,
        hh
      );
    }
    expect(
      await repo.redeemDraftHousehold('ABC-234', 'u2', 'h1', null)
    ).toEqual({ outcome: 'proposal_already_open', household_id: 'h1' });
    expect((await inviteRow())?.status).toBe('pending');
    expect(await memberships('h1')).toHaveLength(1);
  });

  it('maps the early outcomes', async () => {
    expect(
      await repo.redeemDraftHousehold('ABC-234', 'u1', null, null)
    ).toEqual({ outcome: 'self_redemption' });
    expect(
      await repo.redeemDraftHousehold('ZZZ-999', 'u2', null, null)
    ).toEqual({ outcome: 'invite_unavailable' });
    await invite({ id: 'i2', household: 'h1', code: 'LIV-234' });
    expect(
      await repo.redeemDraftHousehold('LIV-234', 'u2', null, null)
    ).toEqual({ outcome: 'not_a_draft_invite' });
    await invite({
      id: 'i3',
      household: 'd1',
      code: 'OLD-234',
      expires_at: '2000-01-01T00:00:00.000Z',
    });
    expect(
      await repo.redeemDraftHousehold('OLD-234', 'u2', null, null)
    ).toEqual({ outcome: 'invite_unavailable' });
    await run(
      "UPDATE household_members SET status = 'removed' WHERE household_id = 'd1'"
    );
    expect(
      await repo.redeemDraftHousehold('ABC-234', 'u2', null, null)
    ).toEqual({ outcome: 'draft_has_no_author' });
  });

  it('redeeming the same code twice at once yields exactly one membership', async () => {
    await member('h1', 'u2', 'owner');
    await member('h1', 'u3', 'parent');
    const results = await Promise.all([
      repo.redeemDraftHousehold('ABC-234', 'u2', 'h1', null),
      repo.redeemDraftHousehold('ABC-234', 'u3', 'h1', null),
      repo.redeemDraftHousehold('ABC-234', 'u2', null, null),
    ]);
    expect(results.filter(r => r.outcome === 'redeemed')).toHaveLength(1);
    const nannyRows = await all(
      "SELECT 1 FROM household_members WHERE user_id = 'u1' AND household_id <> 'd1'"
    );
    expect(nannyRows).toHaveLength(1);
    const live = await all(
      "SELECT 1 FROM households WHERE id NOT IN ('h1', 'd1')"
    );
    const instantiated = results.some(
      r => r.outcome === 'redeemed' && r.instantiated
    );
    expect(live).toHaveLength(instantiated ? 1 : 0);
  });
});
