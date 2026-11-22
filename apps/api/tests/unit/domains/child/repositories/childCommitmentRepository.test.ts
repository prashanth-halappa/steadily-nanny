/** ChildCommitmentRepository + ChildRepository on a real Miniflare D1. */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import { mapDbError } from '../../../../../src/db/errors';
import {
  childCommitments,
  children,
  households,
} from '../../../../../src/db/schema';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let t: TestDb;
let ChildCommitmentRepository: any;
let ChildRepository: any;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  ({ ChildCommitmentRepository } = await import(
    '../../../../../src/domains/child/repositories/childCommitmentRepository'
  ));
  ({ ChildRepository } = await import(
    '../../../../../src/domains/child/repositories/childRepository'
  ));
});

afterAll(() => t.dispose());

beforeEach(async () => {
  await t.d1.prepare('DELETE FROM households').run();
});

async function seedHousehold(id: string, state = 'live') {
  // A draft refuses commitment inserts (093), so seed live, then flip.
  await t.db.insert(households).values({ id, name: id });
  return async () => {
    if (state !== 'live')
      await t.d1
        .prepare('UPDATE households SET state = ? WHERE id = ?')
        .bind(state, id)
        .run();
  };
}

async function seedChild(id: string, householdId: string, archived = false) {
  await t.db.insert(children).values({
    id,
    household_id: householdId,
    name: id,
    archived_at: archived ? new Date().toISOString() : null,
  });
}

const base = {
  kind: 'preschool',
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
  start_time: '09:00:00',
  end_time: '12:00:00',
};

describe('ChildCommitmentRepository', () => {
  it("lists a child's and a household's commitments, oldest first, with JSON exdates", async () => {
    await seedHousehold('h1');
    await seedChild('c1', 'h1');
    await seedChild('c2', 'h1');
    const repo = new ChildCommitmentRepository();
    const a = await repo.create({
      ...base,
      child_id: 'c1',
      household_id: 'h1',
      created_at: '2026-01-01T00:00:00.000Z',
      exdates: ['2026-02-02'],
    });
    await repo.create({
      ...base,
      child_id: 'c2',
      household_id: 'h1',
      created_at: '2026-01-02T00:00:00.000Z',
    });

    const forChild = await repo.findByChildId('c1');
    expect(forChild.map((r: any) => r.id)).toEqual([a.id]);
    expect(forChild[0].exdates).toEqual(['2026-02-02']);
    expect(
      (await repo.findByHouseholdId('h1')).map((r: any) => r.child_id)
    ).toEqual(['c1', 'c2']);
    expect(await repo.findByChildId('nope')).toEqual([]);
  });

  // MIGRATION-NOTES §3 behaviour change: Postgres overwrote household_id with
  // the child's; D1 rejects the mismatch.
  it("rejects a commitment whose household_id is not the child's household", async () => {
    await seedHousehold('h1');
    await seedHousehold('h2');
    await seedChild('c1', 'h1');
    const repo = new ChildCommitmentRepository();
    const err = await repo
      .create({ ...base, child_id: 'c1', household_id: 'h2' })
      .catch((e: unknown) => e);
    expect(mapDbError(err)).toEqual({
      kind: 'check',
      constraint: 'child_commitments_household_matches_child',
    });
    expect(await t.db.select().from(childCommitments)).toEqual([]);
  });

  it('listHouseholdIdsWithCommitments drops drafts and dedupes', async () => {
    await seedHousehold('h-live');
    const flip = await seedHousehold('h-draft', 'draft');
    await seedHousehold('h-empty');
    await seedChild('c1', 'h-live');
    await seedChild('c2', 'h-draft');
    const repo = new ChildCommitmentRepository();
    await repo.create({ ...base, child_id: 'c1', household_id: 'h-live' });
    await repo.create({
      ...base,
      child_id: 'c1',
      household_id: 'h-live',
      start_time: '13:00:00',
      end_time: '14:00:00',
    });
    await repo.create({ ...base, child_id: 'c2', household_id: 'h-draft' });
    await flip();

    expect(await repo.listHouseholdIdsWithCommitments()).toEqual(['h-live']);
  });
});

describe('ChildRepository', () => {
  it('findActiveByHousehold skips archived children; archive stamps archived_at', async () => {
    await seedHousehold('h1');
    await seedChild('c1', 'h1');
    await seedChild('c2', 'h1', true);
    const repo = new ChildRepository();
    expect(
      (await repo.findActiveByHousehold('h1')).map((c: any) => c.id)
    ).toEqual(['c1']);

    const archived = await repo.archive('c1');
    expect(archived.archived_at).toMatch(/Z$/);
    expect(await repo.findActiveByHousehold('h1')).toEqual([]);
  });
});
