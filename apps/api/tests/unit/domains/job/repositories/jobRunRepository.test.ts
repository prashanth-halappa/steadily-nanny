import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

// biome-ignore lint/suspicious/noExplicitAny: test-only mock typing
let JobRunRepository: any;
// biome-ignore lint/suspicious/noExplicitAny: test-only mock typing
let mockSupabaseService: any;

// biome-ignore lint/suspicious/noExplicitAny: test-only mock typing
function createMockQueryChain(finalResponse: {
  data: unknown;
  error: unknown;
}): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    in: mock(() => chain),
    gte: mock(() => chain),
    order: mock(() => chain),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(finalResponse).then(resolve),
  };
  return chain;
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = {
      from: mock(() => createMockQueryChain({ data: [], error: null })),
    };
    return { supabase: obj, supabaseService: obj };
  });

  const mod = await import(
    '../../../../../src/domains/job/repositories/jobRunRepository'
  );
  JobRunRepository = mod.JobRunRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('JobRunRepository.latestPerJob', () => {
  it('collapses to the latest success row per job_name (rows arrive started_at DESC)', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: [
          {
            job_name: 'reminders',
            status: 'success',
            started_at: '2026-08-17T10:00:00Z',
          },
          {
            job_name: 'reminders',
            status: 'success',
            started_at: '2026-08-17T09:00:00Z',
          },
          {
            job_name: 'schedule-horizon',
            status: 'success',
            started_at: '2026-08-17T03:00:00Z',
          },
        ],
        error: null,
      })
    );

    const repo = new JobRunRepository();
    const result = await repo.latestPerJob('2026-08-16T00:00:00Z');

    expect(result).toEqual([
      {
        job_name: 'reminders',
        status: 'success',
        started_at: '2026-08-17T10:00:00Z',
      },
      {
        job_name: 'schedule-horizon',
        status: 'success',
        started_at: '2026-08-17T03:00:00Z',
      },
    ]);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('job_runs');
  });

  it('returns [] when nothing succeeded in the window', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: [], error: null })
    );
    const repo = new JobRunRepository();
    expect(await repo.latestPerJob('2026-08-16T00:00:00Z')).toEqual([]);
  });

  it('throws a DatabaseError on a query failure', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new JobRunRepository();
    await expect(repo.latestPerJob('2026-08-16T00:00:00Z')).rejects.toThrow();
  });
});

describe('JobRunRepository.countByStatusSince', () => {
  it('counts failed/partial runs per job', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: [
          { job_name: 'no-show-sweep', status: 'failed' },
          { job_name: 'no-show-sweep', status: 'failed' },
          { job_name: 'reminders', status: 'partial' },
        ],
        error: null,
      })
    );

    const repo = new JobRunRepository();
    const result = await repo.countByStatusSince('2026-08-16T00:00:00Z');

    expect(result).toEqual(
      expect.arrayContaining([
        { job_name: 'no-show-sweep', status: 'failed', count: 2 },
        { job_name: 'reminders', status: 'partial', count: 1 },
      ])
    );
  });

  it('returns [] when nothing failed', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: [], error: null })
    );
    const repo = new JobRunRepository();
    expect(await repo.countByStatusSince('2026-08-16T00:00:00Z')).toEqual([]);
  });
});
