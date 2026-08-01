import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let SchedulePatternDayRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    order: mock(() => chain),
    insert: mock(() => chain),
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
    '../../../../../src/domains/schedule/repositories/schedulePatternDayRepository'
  );
  SchedulePatternDayRepository = mod.SchedulePatternDayRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('SchedulePatternDayRepository.replaceForPattern', () => {
  it('deletes the pattern’s existing days (cascading away old children) then inserts the new set', async () => {
    let deleteCalled = false;
    const inserted = [{ id: 'd1', pattern_id: 'p1', weekday: 4 }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain(
        deleteCalled
          ? { data: inserted, error: null }
          : (() => {
              deleteCalled = true;
              return { data: null, error: null };
            })()
      )
    );

    const repo = new SchedulePatternDayRepository();
    const result = await repo.replaceForPattern('p1', [
      { weekday: 4, start_time: '08:00', end_time: '17:00' },
    ]);

    expect(result).toEqual(inserted);
    expect(mockSupabaseService.from).toHaveBeenCalledWith(
      'schedule_pattern_days'
    );
  });

  it('deletes existing days and returns [] without inserting when given an empty day set', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new SchedulePatternDayRepository();
    const result = await repo.replaceForPattern('p1', []);
    expect(result).toEqual([]);
  });
});

describe('SchedulePatternDayRepository.listForPattern', () => {
  it('lists a pattern’s days', async () => {
    const rows = [{ id: 'd1', pattern_id: 'p1', weekday: 4 }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new SchedulePatternDayRepository();
    expect(await repo.listForPattern('p1')).toEqual(rows);
  });
});
