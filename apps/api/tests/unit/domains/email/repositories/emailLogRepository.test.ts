/** EmailLogRepository on a real Miniflare D1. */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { user } from '../../../../../src/db/schema';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let t: TestDb;
let EmailLogRepository: any;

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  ({ EmailLogRepository } = await import(
    '../../../../../src/domains/email/repositories/emailLogRepository'
  ));
  await t.db.insert(user).values({ id: 'u1', name: 'u1', email: 'u1@x.test' });
});

afterAll(() => t.dispose());

describe('EmailLogRepository', () => {
  it('logs, dedupes by key, and counts today’s non-failed sends', async () => {
    const row = await EmailLogRepository.logSend({
      userId: 'u1',
      emailType: 'welcome',
      recipient: 'u1@x.test',
      status: 'sent',
      dedupeKey: 'welcome:u1',
      metadata: { a: 1 },
    });
    expect(row.metadata).toEqual({ a: 1 });
    expect(await EmailLogRepository.wasRecentlySent('welcome:u1')).toBe(true);
    expect(await EmailLogRepository.wasRecentlySent('other')).toBe(false);

    // A duplicate dedupe key is a real error, per the contract.
    await expect(
      EmailLogRepository.logSend({
        userId: 'u1',
        emailType: 'welcome',
        recipient: 'u1@x.test',
        status: 'sent',
        dedupeKey: 'welcome:u1',
      })
    ).rejects.toMatchObject({ name: 'DatabaseError' });

    await EmailLogRepository.logSend({
      userId: 'u1',
      emailType: 'x',
      recipient: 'u1@x.test',
      status: 'failed',
    });
    await t.d1
      .prepare(
        "INSERT INTO email_log (id, user_id, email_type, recipient, sent_at) VALUES ('old', 'u1', 'x', 'r', '2000-01-01T00:00:00.000Z')"
      )
      .run();
    expect(await EmailLogRepository.countSentToday('u1')).toBe(1);
  });
});
