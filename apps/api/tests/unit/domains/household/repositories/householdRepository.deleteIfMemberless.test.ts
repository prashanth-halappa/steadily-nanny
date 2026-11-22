/**
 * The orphan reaper's one decision: a household nobody has a row in.
 *
 * ZERO ROWS, NOT ZERO ACTIVE ROWS — this is the load-bearing bit. A nanny who
 * merely left keeps `status = 'removed'` and still reads the hours she worked
 * and the pay she was owed through `householdQueryService.listPastForUser()`
 * (`householdMemberRepository.findMembershipAnyStatus`'s header spells out
 * why: payroll is an audit trail, not a live surface that vanishes with the
 * badge). Sweeping on "no ACTIVE members" would delete the household out from
 * under her — and every `household_id` FK is `on delete cascade` across 19
 * tables, so it would take her tax records with it.
 *
 * A row survives only while the person exists: `household_members.user_id` is
 * `on delete cascade` (009, and 033's header records the deliberate choice not
 * to change it). So "no rows at all" means every person who was ever on this
 * roster has deleted their account — genuinely nobody left.
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
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let t: TestDb;
let repo: {
  deleteIfMemberless(ids: string[]): Promise<string[]>;
  findByIds(ids: string[]): Promise<{ id: string }[]>;
  listLiveIds(ids: string[]): Promise<string[]>;
  listActiveChildFirstNames(householdId: string): Promise<string[]>;
};

const run = (sql: string, ...binds: unknown[]) =>
  t.d1
    .prepare(sql)
    .bind(...binds)
    .run();

async function household(id: string, state = 'live') {
  await run(
    "INSERT INTO households (id, name, state) VALUES (?, 'Home', ?)",
    id,
    state
  );
}

async function member(householdId: string, userId: string, status: string) {
  await run(
    'INSERT OR IGNORE INTO user (id, name, email) VALUES (?, ?, ?)',
    userId,
    userId,
    `${userId}@x.test`
  );
  await run('INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)', userId);
  await run(
    "INSERT INTO household_members (id, household_id, user_id, role, status) VALUES (?, ?, ?, 'nanny', ?)",
    crypto.randomUUID(),
    householdId,
    userId,
    status
  );
}

const PAYROLL: Record<string, string> = {
  time_entries:
    "INSERT INTO time_entries (id, household_id, local_date, timezone, carer_display_name) VALUES (?, ?, '2026-01-05', 'UTC', 'N')",
  timesheets:
    "INSERT INTO timesheets (id, household_id, week_start, carer_display_name) VALUES (?, ?, '2026-01-05', 'N')",
  shifts:
    "INSERT INTO shifts (id, household_id, starts_at, ends_at, timezone, local_date, ical_uid) VALUES (?, ?, '2026-01-05T09:00:00.000Z', '2026-01-05T17:00:00.000Z', 'UTC', '2026-01-05', ?)",
};

async function payroll(table: string, householdId: string) {
  const id = crypto.randomUUID();
  await run(
    PAYROLL[table] as string,
    id,
    householdId,
    ...(table === 'shifts' ? [id] : [])
  );
}

async function remaining(): Promise<string[]> {
  const { results } = await t.d1
    .prepare('SELECT id FROM households ORDER BY id')
    .all<{ id: string }>();
  return results.map((r: { id: string }) => r.id);
}

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const { HouseholdRepository } = await import(
    '../../../../../src/domains/household/repositories/householdRepository'
  );
  repo = new HouseholdRepository();
});

afterAll(() => t.dispose());

beforeEach(async () => {
  await run('DELETE FROM households');
  await run('DELETE FROM user');
});

describe('HouseholdRepository.deleteIfMemberless', () => {
  it('deletes a household whose last member row is gone', async () => {
    await household('h1');
    expect(await repo.deleteIfMemberless(['h1'])).toEqual(['h1']);
    expect(await remaining()).toEqual([]);
  });

  it('SPARES a household where one of two members remains', async () => {
    await household('h1');
    await member('h1', 'u1', 'active');
    expect(await repo.deleteIfMemberless(['h1'])).toEqual([]);
    expect(await remaining()).toEqual(['h1']);
  });

  it('SPARES a household whose only surviving row is a removed past member', async () => {
    await household('h1');
    await member('h1', 'u1', 'removed');
    expect(await repo.deleteIfMemberless(['h1'])).toEqual([]);
  });

  it('SPARES a household whose only surviving row is a candidate', async () => {
    await household('h1');
    await member('h1', 'u1', 'candidate');
    expect(await repo.deleteIfMemberless(['h1'])).toEqual([]);
  });

  it('reaps only the memberless ids out of a mixed batch', async () => {
    await household('h1');
    await household('h2');
    await household('h3');
    await member('h2', 'u1', 'active');
    const reaped = await repo.deleteIfMemberless(['h1', 'h2', 'h3']);
    expect(reaped.sort()).toEqual(['h1', 'h3']);
    expect(await remaining()).toEqual(['h2']);
  });

  it('returns [] for an empty id list', async () => {
    expect(await repo.deleteIfMemberless([])).toEqual([]);
  });

  it('cascades the account deletion: deleting the user leaves the household reapable', async () => {
    await household('h1');
    await member('h1', 'u1', 'active');
    await run("DELETE FROM user WHERE id = 'u1'");
    expect(await repo.deleteIfMemberless(['h1'])).toEqual(['h1']);
  });

  it('throws rather than guessing when the membership read fails', async () => {
    await household('h1');
    await run('ALTER TABLE household_members RENAME TO hm_gone');
    try {
      await expect(repo.deleteIfMemberless(['h1'])).rejects.toMatchObject({
        name: 'DatabaseError',
      });
      expect(await remaining()).toEqual(['h1']);
    } finally {
      await run('ALTER TABLE hm_gone RENAME TO household_members');
    }
  });
});

describe('HouseholdRepository.deleteIfMemberless — payroll history guard', () => {
  for (const table of Object.keys(PAYROLL)) {
    it(`SPARES a memberless household that still has ${table}`, async () => {
      await household('h1');
      await payroll(table, 'h1');
      expect(await repo.deleteIfMemberless(['h1'])).toEqual([]);
      expect(await remaining()).toEqual(['h1']);
    });
  }

  it('reaps only the memberless households with no payroll history of any kind', async () => {
    for (const id of ['h1', 'h2', 'h3', 'h4']) await household(id);
    await payroll('time_entries', 'h1');
    await payroll('shifts', 'h2');
    await member('h3', 'u1', 'removed');
    expect(await repo.deleteIfMemberless(['h1', 'h2', 'h3', 'h4'])).toEqual([
      'h4',
    ]);
  });
});

describe('HouseholdRepository reads', () => {
  it('findByIds returns the named households newest first; [] for none', async () => {
    await run(
      "INSERT INTO households (id, name, created_at) VALUES ('a', 'A', '2026-01-01T00:00:00.000Z'), ('b', 'B', '2026-02-01T00:00:00.000Z'), ('c', 'C', '2026-03-01T00:00:00.000Z')"
    );
    expect((await repo.findByIds(['a', 'b'])).map(h => h.id)).toEqual([
      'b',
      'a',
    ]);
    expect(await repo.findByIds([])).toEqual([]);
  });

  it('listLiveIds drops drafts', async () => {
    await household('live1');
    await household('draft1', 'draft');
    expect(await repo.listLiveIds(['live1', 'draft1'])).toEqual(['live1']);
  });

  it('listActiveChildFirstNames skips archived children', async () => {
    await household('h1');
    await run(
      "INSERT INTO children (id, household_id, name) VALUES ('c1', 'h1', 'Ava'), ('c2', 'h1', 'Ben')"
    );
    await run(
      "UPDATE children SET archived_at = '2026-01-01T00:00:00.000Z' WHERE id = 'c2'"
    );
    expect(await repo.listActiveChildFirstNames('h1')).toEqual(['Ava']);
  });
});
