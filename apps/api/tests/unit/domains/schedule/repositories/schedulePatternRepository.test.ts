import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let SchedulePatternRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    order: mock(() => chain),
    insert: mock(() => chain),
    update: mock(() => chain),
    delete: mock(() => chain),
    maybeSingle: mock(() => Promise.resolve(finalResponse)),
    single: mock(() => Promise.resolve(finalResponse)),
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
    '../../../../../src/domains/schedule/repositories/schedulePatternRepository'
  );
  SchedulePatternRepository = mod.SchedulePatternRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('SchedulePatternRepository.listForHousehold', () => {
  it('lists patterns for a household, newest first', async () => {
    const rows = [{ id: 'p1', household_id: 'h1' }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new SchedulePatternRepository();
    const result = await repo.listForHousehold('h1');
    expect(result).toEqual(rows);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('schedule_patterns');
  });

  it('returns [] when the query returns no rows', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new SchedulePatternRepository();
    expect(await repo.listForHousehold('h1')).toEqual([]);
  });
});
