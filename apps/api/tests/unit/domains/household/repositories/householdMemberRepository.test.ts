/**
 * `household_members` data access on a real D1 (tests/helpers/testDb.ts).
 *
 * Real predicates, not a recording mock: the CAS transitions (remove,
 * reactivate, activate) are only proven by rows that do or do not change, and
 * the roster reads by the profile join actually resolving `user_id` (never
 * `ended_by`, the second FK into `user_profiles` since 112).
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
import { AlreadyMemberError } from '../../../../../src/domains/household/errors/householdErrors';
import type { HouseholdMemberRepository as Repo } from '../../../../../src/domains/household/repositories/householdMemberRepository';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let t: TestDb;
let repo: Repo;

const run = (sql: string, ...binds: unknown[]) =>
  t.d1
    .prepare(sql)
    .bind(...binds)
    .run();

async function person(id: string, name: string | null, phone?: string) {
  await run(
    'INSERT INTO user (id, name, email) VALUES (?, ?, ?)',
    id,
    id,
    `${id}@x.test`
  );
  await run(
    'INSERT INTO user_profiles (user_id, name, phone) VALUES (?, ?, ?)',
    id,
    name,
    phone ?? null
  );
}

interface MemberSeed {
  id: string;
  household: string;
  user: string;
  status?: string;
  role?: string;
  joined_at?: string;
  ended_at?: string | null;
  ended_by?: string | null;
}

async function member(m: MemberSeed) {
  await run(
    'INSERT INTO household_members (id, household_id, user_id, role, status, joined_at, ended_at, ended_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    m.id,
    m.household,
    m.user,
    m.role ?? 'nanny',
    m.status ?? 'active',
    m.joined_at ?? '2026-01-01T00:00:00.000Z',
    m.ended_at ?? null,
    m.ended_by ?? null
  );
}

const statusOf = async (id: string) =>
  (
    await t.d1
      .prepare('SELECT status FROM household_members WHERE id = ?')
      .bind(id)
      .first<{ status: string }>()
  )?.status;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const { HouseholdMemberRepository } = await import(
    '../../../../../src/domains/household/repositories/householdMemberRepository'
  );
  repo = new HouseholdMemberRepository();
});

afterAll(() => t.dispose());

beforeEach(async () => {
  await run('DELETE FROM households');
  await run('DELETE FROM user');
  await run(
    "INSERT INTO households (id, name) VALUES ('h1', 'One'), ('h2', 'Two')"
  );
  await person('parent', 'Pat', '+15550001');
  await person('nanny', 'Nia', '+15550002');
  await person('helper', 'Hal');
});

describe('HouseholdMemberRepository.createMembership', () => {
  it('returns the created row on success', async () => {
    const row = await repo.createMembership({
      household_id: 'h1',
      user_id: 'nanny',
      role: 'nanny',
    });
    expect(row).toMatchObject({
      household_id: 'h1',
      user_id: 'nanny',
      role: 'nanny',
      status: 'active',
      can_edit: false,
    });
  });

  it('translates the (user_id, household_id) unique into AlreadyMemberError, not a 500', async () => {
    await member({
      id: 'm1',
      household: 'h1',
      user: 'nanny',
      status: 'removed',
    });
    await expect(
      repo.createMembership({
        household_id: 'h1',
        user_id: 'nanny',
        role: 'nanny',
      })
    ).rejects.toBeInstanceOf(AlreadyMemberError);
  });

  it('rethrows any other failure as DatabaseError', async () => {
    await expect(
      repo.createMembership({
        household_id: 'h1',
        user_id: 'nobody',
        role: 'nanny',
      })
    ).rejects.toMatchObject({ name: 'DatabaseError' });
  });
});

describe('HouseholdMemberRepository single-row lookups', () => {
  beforeEach(async () => {
    await member({ id: 'a', household: 'h1', user: 'parent', role: 'owner' });
    await member({
      id: 'r',
      household: 'h1',
      user: 'nanny',
      status: 'removed',
    });
    await member({
      id: 'c',
      household: 'h1',
      user: 'helper',
      status: 'candidate',
    });
  });

  it('findActiveMembership finds only an active row', async () => {
    expect((await repo.findActiveMembership('h1', 'parent'))?.id).toBe('a');
    expect(await repo.findActiveMembership('h1', 'nanny')).toBeNull();
    expect(await repo.findActiveMembership('h2', 'parent')).toBeNull();
  });

  it('findMembershipAnyStatus finds active and removed, never a candidate', async () => {
    expect((await repo.findMembershipAnyStatus('h1', 'parent'))?.id).toBe('a');
    expect((await repo.findMembershipAnyStatus('h1', 'nanny'))?.id).toBe('r');
    expect(await repo.findMembershipAnyStatus('h1', 'helper')).toBeNull();
    expect(await repo.findMembershipAnyStatus('h2', 'nanny')).toBeNull();
  });

  it('findMembershipIncludingCandidate applies no status filter', async () => {
    expect(
      (await repo.findMembershipIncludingCandidate('h1', 'helper'))?.id
    ).toBe('c');
    expect(
      await repo.findMembershipIncludingCandidate('h2', 'helper')
    ).toBeNull();
  });

  it('throws a DatabaseError when the query fails', async () => {
    await run('ALTER TABLE household_members RENAME TO hm_gone');
    try {
      await expect(
        repo.findMembershipIncludingCandidate('h1', 'helper')
      ).rejects.toMatchObject({ name: 'DatabaseError' });
    } finally {
      await run('ALTER TABLE hm_gone RENAME TO household_members');
    }
  });
});

describe('HouseholdMemberRepository CAS transitions', () => {
  it('activateCandidate flips a candidate to active; null for any other status', async () => {
    await member({
      id: 'c',
      household: 'h1',
      user: 'nanny',
      status: 'candidate',
    });
    await member({
      id: 'r',
      household: 'h1',
      user: 'helper',
      status: 'removed',
    });
    expect((await repo.activateCandidate('c'))?.status).toBe('active');
    expect(await repo.activateCandidate('c')).toBeNull();
    expect(await repo.activateCandidate('r')).toBeNull();
    expect(await statusOf('r')).toBe('removed');
  });

  it('removeMembership removes active and candidate rows; a second remove is null', async () => {
    await member({ id: 'a', household: 'h1', user: 'nanny' });
    await member({
      id: 'c',
      household: 'h1',
      user: 'helper',
      status: 'candidate',
    });
    expect((await repo.removeMembership('a'))?.status).toBe('removed');
    expect(await repo.removeMembership('a')).toBeNull();
    expect((await repo.removeMembership('c'))?.status).toBe('removed');
  });

  it('reactivateMembership restores a removed row with the invite role and can_edit false', async () => {
    await member({
      id: 'r',
      household: 'h1',
      user: 'nanny',
      status: 'removed',
    });
    await run("UPDATE household_members SET can_edit = 1 WHERE id = 'r'");
    const row = await repo.reactivateMembership('r', 'helper');
    expect(row).toMatchObject({
      status: 'active',
      role: 'helper',
      can_edit: false,
    });
    expect(await repo.reactivateMembership('r', 'helper')).toBeNull();
  });
});

describe('HouseholdMemberRepository per-user reads', () => {
  beforeEach(async () => {
    await member({
      id: 'm2',
      household: 'h2',
      user: 'nanny',
      joined_at: '2026-02-01T00:00:00.000Z',
    });
    await member({
      id: 'm1',
      household: 'h1',
      user: 'nanny',
      status: 'removed',
    });
  });

  it('listActiveByUser returns only active rows', async () => {
    expect((await repo.listActiveByUser('nanny')).map(m => m.id)).toEqual([
      'm2',
    ]);
    expect(await repo.listActiveByUser('parent')).toEqual([]);
  });

  it('listByUser returns every row, oldest-joined first', async () => {
    expect((await repo.listByUser('nanny')).map(m => m.id)).toEqual([
      'm1',
      'm2',
    ]);
  });

  it('listActiveHouseholdIds / listRemovedHouseholdIds are disjoint id lists', async () => {
    expect(await repo.listActiveHouseholdIds('nanny')).toEqual(['h2']);
    expect(await repo.listRemovedHouseholdIds('nanny')).toEqual(['h1']);
    expect(await repo.listRemovedHouseholdIds('parent')).toEqual([]);
  });
});

describe('HouseholdMemberRepository roster reads', () => {
  beforeEach(async () => {
    await member({
      id: 'p',
      household: 'h1',
      user: 'parent',
      role: 'owner',
      joined_at: '2026-01-01T00:00:00.000Z',
    });
    await member({
      id: 'n',
      household: 'h1',
      user: 'nanny',
      status: 'candidate',
      joined_at: '2026-01-02T00:00:00.000Z',
    });
    await member({
      id: 'x',
      household: 'h1',
      user: 'helper',
      status: 'removed',
      ended_at: '2026-03-01T00:00:00.000Z',
      ended_by: 'parent',
    });
  });

  it('listActiveByHousehold: active only, profile_name joined via user_id, no phone', async () => {
    const rows = await repo.listActiveByHousehold('h1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'p', profile_name: 'Pat' });
    expect(rows[0]).not.toHaveProperty('profile_phone');
    expect(rows[0]).not.toHaveProperty('user_profiles');
  });

  it('listNonRemovedByHousehold: active + candidate, oldest first, with name and phone', async () => {
    const rows = await repo.listNonRemovedByHousehold('h1');
    expect(rows.map(r => [r.id, r.profile_name, r.profile_phone])).toEqual([
      ['p', 'Pat', '+15550001'],
      ['n', 'Nia', '+15550002'],
    ]);
  });

  it('profile fields are null when the profile has none', async () => {
    await run(
      "UPDATE user_profiles SET name = NULL, phone = NULL WHERE user_id = 'nanny'"
    );
    const rows = await repo.listNonRemovedByHousehold('h1');
    expect(rows[1]).toMatchObject({
      id: 'n',
      profile_name: null,
      profile_phone: null,
    });
  });

  it('listDepartedSince: removed since the window, the member’s name (not ended_by’s)', async () => {
    const rows = await repo.listDepartedSince('h1', '2026-02-01T00:00:00.000Z');
    expect(rows.map(r => [r.id, r.profile_name])).toEqual([['x', 'Hal']]);
    expect(
      await repo.listDepartedSince('h1', '2026-04-01T00:00:00.000Z')
    ).toEqual([]);
  });

  it('listDepartedSince: most recent departure first; NULL ended_at never surfaces', async () => {
    await person('old', 'Olly');
    await person('late', 'Lee');
    await member({ id: 'o', household: 'h1', user: 'old', status: 'removed' });
    await member({
      id: 'l',
      household: 'h1',
      user: 'late',
      status: 'removed',
      ended_at: '2026-03-05T00:00:00.000Z',
    });
    const rows = await repo.listDepartedSince('h1', '2026-01-01T00:00:00.000Z');
    expect(rows.map(r => r.id)).toEqual(['l', 'x']);
  });
});
