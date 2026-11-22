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
let JobRunRepository: typeof import('../../../../../src/domains/job/repositories/jobRunRepository').JobRunRepository;

const seed = (id: string, job: string, status: string, startedAt: string) =>
  t.d1
    .prepare(
      'INSERT INTO job_runs (id, job_name, status, started_at) VALUES (?, ?, ?, ?)'
    )
    .bind(id, job, status, startedAt)
    .run();

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  ({ JobRunRepository } = await import(
    '../../../../../src/domains/job/repositories/jobRunRepository'
  ));
});
afterAll(() => t.dispose());
beforeEach(() => t.d1.prepare('DELETE FROM job_runs').run());

const SINCE = '2026-08-01T00:00:00.000Z';

describe('JobRunRepository.latestPerJob', () => {
  it('collapses to the latest success per job inside the window', async () => {
    await seed('a1', 'reminders', 'success', '2026-08-02T01:00:00.000Z');
    await seed('a2', 'reminders', 'success', '2026-08-02T05:00:00.000Z');
    await seed('a3', 'reminders', 'failed', '2026-08-02T09:00:00.000Z');
    await seed('b1', 'no-show-sweep', 'success', '2026-07-01T00:00:00.000Z');

    const rows = await new JobRunRepository().latestPerJob(SINCE);
    expect(rows).toEqual([
      {
        job_name: 'reminders',
        status: 'success',
        started_at: '2026-08-02T05:00:00.000Z',
      },
    ]);
  });

  it('returns [] when nothing succeeded in the window', async () => {
    await seed('a1', 'reminders', 'failed', '2026-08-02T01:00:00.000Z');
    expect(await new JobRunRepository().latestPerJob(SINCE)).toEqual([]);
  });
});

describe('JobRunRepository.countByStatusSince', () => {
  it('counts failed/partial runs per job and status', async () => {
    await seed('a1', 'reminders', 'failed', '2026-08-02T01:00:00.000Z');
    await seed('a2', 'reminders', 'failed', '2026-08-02T02:00:00.000Z');
    await seed('a3', 'reminders', 'partial', '2026-08-02T03:00:00.000Z');
    await seed('a4', 'reminders', 'success', '2026-08-02T04:00:00.000Z');

    const rows = await new JobRunRepository().countByStatusSince(SINCE);
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({
      job_name: 'reminders',
      status: 'failed',
      count: 2,
    });
    expect(rows).toContainEqual({
      job_name: 'reminders',
      status: 'partial',
      count: 1,
    });
  });

  it('returns [] when nothing failed', async () => {
    expect(await new JobRunRepository().countByStatusSince(SINCE)).toEqual([]);
  });
});

describe('JobRunRepository.countRunsSince', () => {
  it('counts runs of any status per job inside the window', async () => {
    await seed('a1', 'reminders', 'success', '2026-08-02T01:00:00.000Z');
    await seed('a2', 'reminders', 'failed', '2026-08-02T02:00:00.000Z');
    await seed('a3', 'reminders', 'running', '2026-07-01T00:00:00.000Z');
    await seed('b1', 'no-show-sweep', 'success', '2026-08-02T02:00:00.000Z');

    const rows = await new JobRunRepository().countRunsSince(SINCE);
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ job_name: 'reminders', count: 2 });
    expect(rows).toContainEqual({ job_name: 'no-show-sweep', count: 1 });
  });
});
