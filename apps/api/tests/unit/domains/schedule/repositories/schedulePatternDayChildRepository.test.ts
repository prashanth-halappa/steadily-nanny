import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let SchedulePatternDayChildRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    in: mock(() => chain),
    insert: mock(() => chain),
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
    '../../../../../src/domains/schedule/repositories/schedulePatternDayChildRepository'
  );
  SchedulePatternDayChildRepository = mod.SchedulePatternDayChildRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('SchedulePatternDayChildRepository.insertForDay', () => {
  it('inserts child rows scoped to the given pattern_day_id', async () => {
    const inserted = [{ id: 'c1', pattern_day_id: 'd1', child_id: 'child-1' }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: inserted, error: null })
    );
    const repo = new SchedulePatternDayChildRepository();
    const result = await repo.insertForDay('d1', [{ child_id: 'child-1' }]);
    expect(result).toEqual(inserted);
  });

  it('returns [] without a DB call when given no children', async () => {
    const repo = new SchedulePatternDayChildRepository();
    const result = await repo.insertForDay('d1', []);
    expect(result).toEqual([]);
    expect(mockSupabaseService.from).not.toHaveBeenCalled();
  });
});

describe('SchedulePatternDayChildRepository.listForDays', () => {
  it('lists children for a set of pattern_day ids', async () => {
    const rows = [{ id: 'c1', pattern_day_id: 'd1', child_id: 'child-1' }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new SchedulePatternDayChildRepository();
    expect(await repo.listForDays(['d1'])).toEqual(rows);
  });

  it('returns [] without a DB call for an empty id list', async () => {
    const repo = new SchedulePatternDayChildRepository();
    expect(await repo.listForDays([])).toEqual([]);
    expect(mockSupabaseService.from).not.toHaveBeenCalled();
  });
});
