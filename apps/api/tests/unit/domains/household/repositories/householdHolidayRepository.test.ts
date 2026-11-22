/**
 * `household_holidays` data access (080), on a real D1 (tests/helpers/testDb.ts).
 *
 * The two things that silently break: the upsert's conflict target (wrong,
 * and every save fails on the unique or inserts a duplicate toggle), and
 * whether the seed leaves existing rows alone. `updated_at` is owned by the
 * `set_household_holidays_updated_at` trigger, never written from TypeScript.
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
import { holidayKeysForCountry } from '@steadily-nanny/shared-types/holidayPacks';
import type { HouseholdHolidayRepository as Repo } from '../../../../../src/domains/household/repositories/householdHolidayRepository';
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
  const { HouseholdHolidayRepository } = await import(
    '../../../../../src/domains/household/repositories/householdHolidayRepository'
  );
  repo = new HouseholdHolidayRepository();
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

describe('HouseholdHolidayRepository.listForHousehold', () => {
  it('scopes the read to the household, key-ascending', async () => {
    await repo.upsertMany(H, [
      { holiday_key: 'us_new_years_day', observed: true },
      { holiday_key: 'us_christmas_day', observed: false },
    ]);
    await repo.upsertMany(OTHER, [
      { holiday_key: 'us_labor_day', observed: true },
    ]);
    const rows = await repo.listForHousehold(H);
    expect(rows.map(r => r.holiday_key)).toEqual([
      'us_christmas_day',
      'us_new_years_day',
    ]);
    expect(rows[0]?.observed).toBe(false);
  });

  it('returns [] when the household has no toggles yet', async () => {
    expect(await repo.listForHousehold(H)).toEqual([]);
  });

  it('throws DatabaseError when the read fails', async () => {
    await run('ALTER TABLE household_holidays RENAME TO hh_gone');
    try {
      await expect(repo.listForHousehold(H)).rejects.toMatchObject({
        name: 'DatabaseError',
      });
    } finally {
      await run('ALTER TABLE hh_gone RENAME TO household_holidays');
    }
  });
});

describe('HouseholdHolidayRepository.upsertMany', () => {
  it('overwrites an existing toggle on (household_id, holiday_key)', async () => {
    const [first] = await repo.upsertMany(H, [
      { holiday_key: 'us_labor_day', observed: true },
    ]);
    const [second] = await repo.upsertMany(H, [
      { holiday_key: 'us_labor_day', observed: false },
    ]);
    expect(second?.id).toBe(first?.id as string);
    expect(second?.observed).toBe(false);
    expect(await repo.listForHousehold(H)).toHaveLength(1);
  });

  it('leaves keys it does not name untouched', async () => {
    await repo.upsertMany(H, [
      { holiday_key: 'a', observed: true },
      { holiday_key: 'b', observed: true },
    ]);
    await repo.upsertMany(H, [{ holiday_key: 'a', observed: false }]);
    const rows = await repo.listForHousehold(H);
    expect(rows.map(r => [r.holiday_key, r.observed])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });
});

describe('HouseholdHolidayRepository.seedCountryPack', () => {
  it('writes one observed row per key in the country pack', async () => {
    const rows = await repo.seedCountryPack(H, 'US');
    const usKeys = holidayKeysForCountry('US');
    expect(rows.map(r => r.holiday_key).sort()).toEqual([...usKeys].sort());
    expect(rows.every(r => r.observed === true && r.household_id === H)).toBe(
      true
    );
  });

  it('seeds the Canadian pack when the household country is CA', async () => {
    const rows = await repo.seedCountryPack(H, 'CA');
    expect(rows.map(r => r.holiday_key).sort()).toEqual(
      [...holidayKeysForCountry('CA')].sort()
    );
  });

  it('ignores duplicates so a retried creation cannot fail or reset toggles', async () => {
    await repo.seedCountryPack(H, 'US');
    const key = holidayKeysForCountry('US')[0] as string;
    await repo.upsertMany(H, [{ holiday_key: key, observed: false }]);

    const retried = await repo.seedCountryPack(H, 'US');
    expect(retried).toEqual([]);
    const rows = await repo.listForHousehold(H);
    expect(rows).toHaveLength(holidayKeysForCountry('US').length);
    expect(rows.find(r => r.holiday_key === key)?.observed).toBe(false);
  });
});

describe('HouseholdHolidayRepository.deleteKeysNotIn', () => {
  it('deletes only this household’s rows whose key is not in the keep set', async () => {
    await repo.upsertMany(H, [
      { holiday_key: 'keep', observed: true },
      { holiday_key: 'stale', observed: true },
    ]);
    await repo.upsertMany(OTHER, [{ holiday_key: 'stale', observed: true }]);
    await repo.deleteKeysNotIn(H, ['keep']);
    expect((await repo.listForHousehold(H)).map(r => r.holiday_key)).toEqual([
      'keep',
    ]);
    expect(await repo.listForHousehold(OTHER)).toHaveLength(1);
  });

  it('no-ops when nothing is stale', async () => {
    await repo.upsertMany(H, [{ holiday_key: 'keep', observed: true }]);
    await repo.deleteKeysNotIn(H, ['keep', 'other']);
    expect(await repo.listForHousehold(H)).toHaveLength(1);
  });
});
