/**
 * `ReminderLogRepository` on a real Miniflare D1 — scoping bugs (a `release`
 * that forgot one key of the `(user_id, reminder_key)` pair) show up as real
 * rows surviving or vanishing.
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
import {
  pushReminderLog,
  user,
  userProfiles,
} from '../../../../../src/db/schema';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let t: TestDb;
let ReminderLogRepository: any;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  mock.module('../../../../../src/middlewares/logger', () => ({
    logger: {
      info: mock(() => undefined),
      error: mock(() => undefined),
      warn: mock(() => undefined),
      debug: mock(() => undefined),
    },
  }));
  ({ ReminderLogRepository } = await import(
    '../../../../../src/domains/notification/repositories/reminderLogRepository'
  ));
  for (const id of ['user-1', 'user-2', 'user-OTHER', 'u1', 'u2', 'u3']) {
    await t.db.insert(user).values({ id, name: id, email: `${id}@x.test` });
    await t.db.insert(userProfiles).values({ user_id: id });
  }
});

afterAll(() => t.dispose());

beforeEach(async () => {
  await t.d1.prepare('DELETE FROM push_reminder_log').run();
});

const seed = (rows: (typeof pushReminderLog.$inferInsert)[]) =>
  t.db.insert(pushReminderLog).values(rows);

const all = () =>
  t.db
    .select()
    .from(pushReminderLog)
    .orderBy(pushReminderLog.user_id, pushReminderLog.reminder_key);

describe('ReminderLogRepository.claim', () => {
  it('wins on a fresh pair, loses on a duplicate, and is per-user', async () => {
    const repo = new ReminderLogRepository();
    expect(await repo.claim('user-1', 'shift_reminder:s1')).toBe(true);
    expect(await repo.claim('user-1', 'shift_reminder:s1')).toBe(false);
    expect(await repo.claim('user-OTHER', 'shift_reminder:s1')).toBe(true);
  });

  it('throws on a non-unique failure (unknown user → FK)', async () => {
    const repo = new ReminderLogRepository();
    await expect(repo.claim('ghost', 'k')).rejects.toMatchObject({
      name: 'DatabaseError',
    });
  });
});

describe('ReminderLogRepository.findLastSentAt', () => {
  it('returns the newest sent_at under the prefix for that user only', async () => {
    await seed([
      {
        user_id: 'user-1',
        reminder_key: 'p:1:a',
        sent_at: '2026-01-01T00:00:00.000Z',
      },
      {
        user_id: 'user-1',
        reminder_key: 'p:1:b',
        sent_at: '2026-01-03T00:00:00.000Z',
      },
      {
        user_id: 'user-1',
        reminder_key: 'p:2:a',
        sent_at: '2026-01-09T00:00:00.000Z',
      },
      {
        user_id: 'user-2',
        reminder_key: 'p:1:c',
        sent_at: '2026-01-09T00:00:00.000Z',
      },
    ]);
    const repo = new ReminderLogRepository();
    expect(await repo.findLastSentAt('user-1', 'p:1:')).toBe(
      '2026-01-03T00:00:00.000Z'
    );
    expect(await repo.findLastSentAt('user-1', 'p:9:')).toBeNull();
  });
});

describe('ReminderLogRepository.release', () => {
  it('deletes only the matching pair, and the slot can be re-claimed', async () => {
    await seed([
      { user_id: 'user-1', reminder_key: 'shift_reminder:s1' },
      { user_id: 'user-1', reminder_key: 'shift_reminder:s2' },
      { user_id: 'user-2', reminder_key: 'shift_reminder:s1' },
    ]);
    const repo = new ReminderLogRepository();
    await repo.release('user-1', 'shift_reminder:s1');
    expect((await all()).map(r => `${r.user_id}/${r.reminder_key}`)).toEqual([
      'user-1/shift_reminder:s2',
      'user-2/shift_reminder:s1',
    ]);
    expect(await repo.claim('user-1', 'shift_reminder:s1')).toBe(true);
  });
});

describe('ReminderLogRepository.confirm', () => {
  it('stamps confirmed_at on exactly the matching row', async () => {
    await seed([
      { user_id: 'user-1', reminder_key: 'k1' },
      { user_id: 'user-1', reminder_key: 'k2' },
      { user_id: 'user-2', reminder_key: 'k1' },
    ]);
    await new ReminderLogRepository().confirm('user-1', 'k1');
    expect((await all()).map(r => r.confirmed_at !== null)).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe('ReminderLogRepository.sweepStaleClaims', () => {
  const hoursAgo = (hours: number) =>
    new Date(Date.now() - hours * 3_600_000).toISOString();

  it('deletes only unconfirmed claims older than the horizon', async () => {
    await seed([
      { user_id: 'u1', reminder_key: 'stale', sent_at: hoursAgo(5) },
      {
        user_id: 'u2',
        reminder_key: 'delivered',
        confirmed_at: hoursAgo(5),
        sent_at: hoursAgo(5),
      },
      { user_id: 'u3', reminder_key: 'in-flight', sent_at: hoursAgo(0.1) },
    ]);
    await new ReminderLogRepository().sweepStaleClaims();
    expect((await all()).map(r => r.reminder_key)).toEqual([
      'delivered',
      'in-flight',
    ]);
  });
});
