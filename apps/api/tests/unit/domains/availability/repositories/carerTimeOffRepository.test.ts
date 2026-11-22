/** CarerTimeOffRepository on a real D1 (testDb). */
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

async function timeOff(id: string, userId: string, startsAt: string) {
  const ends = new Date(new Date(startsAt).getTime() + 86_400_000);
  return repo.create({
    id,
    user_id: userId,
    starts_at: startsAt,
    ends_at: ends.toISOString(),
  });
}

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  const { CarerTimeOffRepository } = await import(
    '../../../../../src/domains/availability/repositories/carerTimeOffRepository'
  );
  repo = new CarerTimeOffRepository();
  for (const u of ['u1', 'u2', 'u3']) {
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
  await t.d1.prepare('DELETE FROM carer_time_off').run();
});

describe('CarerTimeOffRepository.listByUserId', () => {
  it("returns only that user's rows, earliest first", async () => {
    await timeOff('t2', 'u1', '2026-02-01T00:00:00.000Z');
    await timeOff('t1', 'u1', '2026-01-01T00:00:00.000Z');
    await timeOff('tx', 'u2', '2026-01-15T00:00:00.000Z');

    const rows = await repo.listByUserId('u1');
    expect(rows.map((r: { id: string }) => r.id)).toEqual(['t1', 't2']);
    expect(rows[0]).toMatchObject({
      user_id: 'u1',
      all_day: true,
      status: 'confirmed',
      kind: 'personal',
    });
  });

  it('returns [] when there are no rows', async () => {
    expect(await repo.listByUserId('u1')).toEqual([]);
  });
});

describe('CarerTimeOffRepository.listByUserIds', () => {
  it('returns rows for any of the ids, earliest first, cancelled included', async () => {
    await timeOff('a', 'u1', '2026-03-01T00:00:00.000Z');
    await timeOff('b', 'u2', '2026-01-01T00:00:00.000Z');
    await timeOff('c', 'u3', '2026-02-01T00:00:00.000Z');
    await repo.cancelById('a');

    const rows = await repo.listByUserIds(['u1', 'u2']);
    expect(rows.map((r: { id: string }) => r.id)).toEqual(['b', 'a']);
  });

  it('returns [] for an empty id list', async () => {
    expect(await repo.listByUserIds([])).toEqual([]);
  });
});

describe('CarerTimeOffRepository.cancelById', () => {
  it('soft-cancels — sets status cancelled and returns the row (never a hard delete)', async () => {
    await timeOff('t1', 'u1', '2026-01-01T00:00:00.000Z');
    const result = await repo.cancelById('t1');
    expect(result).toMatchObject({ id: 't1', status: 'cancelled' });
    expect(await repo.findById('t1')).toMatchObject({ status: 'cancelled' });
  });

  // -------------------------------------------------------------------------
  // Phase 3/4 review, BLOCKER 1(a). The cancel write must be CONDITIONAL on
  // the row not already being cancelled, and must report whether it actually
  // transitioned anything — `timeOffCommandService.cancel` fires the PTO
  // reconciliation off the back of it, and a second cancel that "succeeded"
  // against an already-cancelled row re-fires that reconciliation.
  // -------------------------------------------------------------------------
  it('returns null on a repeat cancel — the guarded update matched nothing', async () => {
    await timeOff('t1', 'u1', '2026-01-01T00:00:00.000Z');
    expect(await repo.cancelById('t1')).not.toBeNull();
    expect(await repo.cancelById('t1')).toBeNull();
  });

  it('returns null for an unknown id', async () => {
    expect(await repo.cancelById('nope')).toBeNull();
  });
});
