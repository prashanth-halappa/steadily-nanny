/**
 * JobRunService against a real D1: the run lifecycle, the in-flight guard
 * (`hasFreshRunningRun`) and idempotency-key reclaim. A stale 'running' row
 * (crashed/abandoned) must never wedge the schedule forever.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let t: TestDb;
let JobRunService: typeof import('../../../../../src/domains/job/services/jobRunService').JobRunService;

const row = async (id: string) =>
  (await t.d1
    .prepare('SELECT * FROM job_runs WHERE id = ?')
    .bind(id)
    .first()) as Record<string, unknown> | null;
const seed = (
  id: string,
  status: string,
  startedAt: string,
  key: string | null = null
) =>
  t.d1
    .prepare(
      'INSERT INTO job_runs (id, job_name, status, started_at, idempotency_key) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(id, 'example-maintenance', status, startedAt, key)
    .run();

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  ({ JobRunService } = await import(
    '../../../../../src/domains/job/services/jobRunService'
  ));
});
afterAll(() => t.dispose());
beforeEach(() => t.d1.prepare('DELETE FROM job_runs').run());

describe('JobRunService lifecycle', () => {
  test('start → complete records status, counts and job-specific summary', async () => {
    const id = await JobRunService.start('reminders');
    expect((await row(id))?.status).toBe('running');

    await JobRunService.complete(id, {
      totalProcessed: 3,
      successCount: 2,
      errorCount: 1,
      errorDetails: [{ error: 'boom' }],
      extra: 'x',
    });
    const done = await row(id);
    expect(done).toMatchObject({
      status: 'partial',
      total_processed: 3,
      error_message: 'boom',
    });
    expect(JSON.parse(done?.summary as string)).toEqual({ extra: 'x' });
  });

  test('fail marks the run failed with the error message', async () => {
    const id = await JobRunService.start('reminders');
    await JobRunService.fail(id, new Error('kaput'));
    expect(await row(id)).toMatchObject({
      status: 'failed',
      error_message: 'kaput',
    });
  });

  test('getHistory filters by job and status, newest first', async () => {
    await seed('a', 'success', '2026-08-01T00:00:00.000Z');
    await seed('b', 'success', '2026-08-02T00:00:00.000Z');
    await seed('c', 'failed', '2026-08-03T00:00:00.000Z');
    const rows = await JobRunService.getHistory(
      'example-maintenance',
      10,
      'success'
    );
    expect(rows.map(r => r.id)).toEqual(['b', 'a']);
  });
});

describe('JobRunService.hasFreshRunningRun', () => {
  test('no running row → false', async () => {
    expect(await JobRunService.hasFreshRunningRun('example-maintenance')).toBe(
      false
    );
  });

  test('a running row started seconds ago → true', async () => {
    await seed('r', 'running', new Date().toISOString());
    expect(await JobRunService.hasFreshRunningRun('example-maintenance')).toBe(
      true
    );
  });

  test('a running row older than the stale threshold → false', async () => {
    await seed(
      'r',
      'running',
      new Date(Date.now() - 60 * 60 * 1000).toISOString()
    );
    expect(await JobRunService.hasFreshRunningRun('example-maintenance')).toBe(
      false
    );
  });
});

describe('JobRunService.startWithIdempotencyKey', () => {
  test('first call inserts; a completed key refuses; a fresh running key refuses', async () => {
    const id = await JobRunService.startWithIdempotencyKey(
      'example-maintenance',
      'k1'
    );
    await expect(
      JobRunService.startWithIdempotencyKey('example-maintenance', 'k1')
    ).rejects.toThrow('already running');
    await JobRunService.complete(id, { successCount: 1 });
    await expect(
      JobRunService.startWithIdempotencyKey('example-maintenance', 'k1')
    ).rejects.toThrow('already completed');
  });

  test('a failed run under the key is reclaimed in place', async () => {
    await seed('f', 'failed', '2026-08-01T00:00:00.000Z', 'k2');
    const id = await JobRunService.startWithIdempotencyKey(
      'example-maintenance',
      'k2'
    );
    expect(id).toBe('f');
    const reclaimed = await row('f');
    expect(reclaimed).toMatchObject({ status: 'running', error_message: null });
    expect(reclaimed?.started_at).not.toBe('2026-08-01T00:00:00.000Z');
  });
});
