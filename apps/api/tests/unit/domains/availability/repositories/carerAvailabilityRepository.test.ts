/** CarerAvailabilityRepository on a real D1 (testDb). */
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
let repo: any;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const { CarerAvailabilityRepository } = await import(
    '../../../../../src/domains/availability/repositories/carerAvailabilityRepository'
  );
  repo = new CarerAvailabilityRepository();
  for (const u of ['u1', 'u2']) {
    await t.d1
      .prepare('INSERT INTO user (id, name, email) VALUES (?, ?, ?)')
      .bind(u, u, `${u}@x.test`)
      .run();
    await t.d1
      .prepare('INSERT INTO user_profiles (user_id) VALUES (?)')
      .bind(u)
      .run();
  }
});

afterAll(() => t.dispose());

beforeEach(async () => {
  await t.d1.prepare('DELETE FROM carer_availability').run();
});

describe('CarerAvailabilityRepository.findByUserId', () => {
  it("returns only that user's rows, ordered by weekday", async () => {
    await repo.upsertForWeekday('u1', 3, { is_available: true });
    await repo.upsertForWeekday('u1', 1, { is_available: false });
    await repo.upsertForWeekday('u2', 2, { is_available: true });

    const result = await repo.findByUserId('u1');
    expect(
      result.map((r: { user_id: string; weekday: number }) => [
        r.user_id,
        r.weekday,
      ])
    ).toEqual([
      ['u1', 1],
      ['u1', 3],
    ]);
  });

  it('returns [] when there are no rows', async () => {
    expect(await repo.findByUserId('u1')).toEqual([]);
  });
});

describe('CarerAvailabilityRepository.upsertForWeekday', () => {
  it('inserts a new (user_id, weekday) row and returns it with booleans as booleans', async () => {
    const row = await repo.upsertForWeekday('u1', 2, {
      is_available: true,
      earliest_start: '08:00:00',
      latest_finish: '18:00:00',
    });
    expect(row).toMatchObject({
      user_id: 'u1',
      weekday: 2,
      is_available: true,
      earliest_start: '08:00:00',
      latest_finish: '18:00:00',
      evening_mode: 'never',
    });
  });

  it('updates the existing row on conflict instead of adding a second one', async () => {
    const first = await repo.upsertForWeekday('u1', 2, { is_available: true });
    const second = await repo.upsertForWeekday('u1', 2, {
      is_available: false,
      evening_mode: 'sometimes',
    });
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      is_available: false,
      evening_mode: 'sometimes',
    });
    expect(await repo.findByUserId('u1')).toHaveLength(1);
  });

  it('throws DatabaseError when a CHECK fails', async () => {
    await expect(
      repo.upsertForWeekday('u1', 2, {
        is_available: true,
        earliest_start: '18:00:00',
        latest_finish: '08:00:00',
      })
    ).rejects.toMatchObject({
      name: 'DatabaseError',
      metadata: { kind: 'check', constraint: 'carer_availability_time_order' },
    });
  });
});
