/**
 * JobRunService.hasFreshRunningRun — the in-flight guard's seam.
 *
 * A second cron invocation (pg_net retry, manual POST) landing on top of a
 * still-running job must be told "no" cheaply, without racing the run
 * lifecycle. This is the read the handler factory checks before calling
 * start(): a fresh 'running' row blocks, a stale one (crashed/abandoned) does
 * not — a crashed run must never wedge the schedule forever.
 */
import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

let JobRunService: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    order: mock(() => chain),
    limit: mock(() => chain),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(finalResponse).then(resolve),
  };
  return chain;
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createMockQueryChain()) };
    return { supabase: obj, supabaseService: obj };
  });

  const mod = await import(
    '../../../../../src/domains/job/services/jobRunService'
  );
  JobRunService = mod.JobRunService;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('JobRunService.hasFreshRunningRun', () => {
  test('no running row → false', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: [], error: null })
    );

    expect(await JobRunService.hasFreshRunningRun('example-maintenance')).toBe(
      false
    );
  });

  test('a running row started seconds ago → true', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: [
          {
            id: 'run-1',
            job_name: 'example-maintenance',
            status: 'running',
            started_at: new Date().toISOString(),
          },
        ],
        error: null,
      })
    );

    expect(await JobRunService.hasFreshRunningRun('example-maintenance')).toBe(
      true
    );
  });

  test('a running row started 20 minutes ago (stale) → false', async () => {
    const staleStartedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: [
          {
            id: 'run-1',
            job_name: 'example-maintenance',
            status: 'running',
            started_at: staleStartedAt,
          },
        ],
        error: null,
      })
    );

    expect(await JobRunService.hasFreshRunningRun('example-maintenance')).toBe(
      false
    );
  });
});
