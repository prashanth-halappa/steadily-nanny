import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let SchedulePatternRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    is: mock(() => chain),
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

describe('SchedulePatternRepository.listAcceptedByHouseholdAndCarer', () => {
  it('matches an assigned carer with eq', async () => {
    const chain = createMockQueryChain({ data: [{ id: 'p0' }], error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new SchedulePatternRepository();

    expect(await repo.listAcceptedByHouseholdAndCarer('h1', 'carer-1')).toEqual(
      [{ id: 'p0' }]
    );
    expect(chain.eq).toHaveBeenCalledWith('carer_id', 'carer-1');
    expect(chain.eq).toHaveBeenCalledWith('status', 'accepted');
    expect(chain.is).not.toHaveBeenCalled();
  });

  // A null-carer pattern is a real shape (014: a parent sketching a usual
  // week during onboarding). `eq('carer_id', null)` would match nothing, so
  // the null branch has to use `is`, exactly like
  // `shiftRepository.findExtraShiftInWindow`.
  it('matches an unassigned pattern with is(null), never eq(null)', async () => {
    const chain = createMockQueryChain({ data: [], error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new SchedulePatternRepository();

    await repo.listAcceptedByHouseholdAndCarer('h1', null);

    expect(chain.is).toHaveBeenCalledWith('carer_id', null);
    expect(chain.eq).not.toHaveBeenCalledWith('carer_id', null);
  });
});
