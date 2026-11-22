/**
 * `household_custom_holidays` data access (107), on a real D1.
 *
 * A replace-set, not a toggle: the row existing IS the observance, so an
 * empty payload must delete every row (that is how the last custom day is
 * removed). Deletes go by id after a TypeScript filter.
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
import type { HouseholdCustomHolidayRepository as Repo } from '../../../../../src/domains/household/repositories/householdCustomHolidayRepository';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

const H = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let t: TestDb;
let repo: Repo;

const run = (sql: string, ...binds: unknown[]) =>
  t.d1
    .prepare(sql)
    .bind(...binds)
    .run();

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const { HouseholdCustomHolidayRepository } = await import(
    '../../../../../src/domains/household/repositories/householdCustomHolidayRepository'
  );
  repo = new HouseholdCustomHolidayRepository();
});

afterAll(() => t.dispose());

beforeEach(async () => {
  await run('DELETE FROM households');
  await run(
    "INSERT INTO households (id, name) VALUES (?, 'A'), (?, 'B')",
    H,
    OTHER
  );
});

describe('HouseholdCustomHolidayRepository.listForHousehold', () => {
  it('returns [] when the household has no custom days yet', async () => {
    expect(await repo.listForHousehold(H)).toEqual([]);
  });

  it('throws DatabaseError when the read fails', async () => {
    await run('ALTER TABLE household_custom_holidays RENAME TO hch_gone');
    try {
      await expect(repo.listForHousehold(H)).rejects.toMatchObject({
        name: 'DatabaseError',
      });
    } finally {
      await run('ALTER TABLE hch_gone RENAME TO household_custom_holidays');
    }
  });
});

describe('HouseholdCustomHolidayRepository.replaceSet', () => {
  it('inserts rows, name-ascending, with dates round-tripped as an array', async () => {
    const rows = await repo.replaceSet(H, [
      { name: 'Teacher day', dates: ['2026-05-01'] },
      { name: 'Eid', dates: ['2026-03-20', '2026-03-21'] },
    ]);
    expect(rows.map(r => r.name)).toEqual(['Eid', 'Teacher day']);
    expect(rows[0]?.dates).toEqual(['2026-03-20', '2026-03-21']);
  });

  it('upserts on (household_id, name): same id, new dates', async () => {
    const [first] = await repo.replaceSet(H, [
      { name: 'Eid', dates: ['2026-03-20'] },
    ]);
    const [second] = await repo.replaceSet(H, [
      { name: 'Eid', dates: ['2026-03-21'] },
    ]);
    expect(second?.id).toBe(first?.id as string);
    expect(second?.dates).toEqual(['2026-03-21']);
  });

  it('deletes rows whose name is not in the payload, this household only', async () => {
    await repo.replaceSet(H, [
      { name: 'Keep', dates: ['2026-01-02'] },
      { name: 'Drop', dates: ['2026-01-03'] },
    ]);
    await repo.replaceSet(OTHER, [{ name: 'Drop', dates: ['2026-01-03'] }]);
    const rows = await repo.replaceSet(H, [
      { name: 'Keep', dates: ['2026-01-02'] },
    ]);
    expect(rows.map(r => r.name)).toEqual(['Keep']);
    expect(await repo.listForHousehold(OTHER)).toHaveLength(1);
  });

  it('clears every row when the payload is empty', async () => {
    await repo.replaceSet(H, [{ name: 'Eid', dates: ['2026-03-20'] }]);
    expect(await repo.replaceSet(H, [])).toEqual([]);
    expect(await repo.listForHousehold(H)).toEqual([]);
  });
});
