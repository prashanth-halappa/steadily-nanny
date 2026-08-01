import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let TimesheetRepository: any;
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
    '../../../../../src/domains/timesheet/repositories/timesheetRepository'
  );
  TimesheetRepository = mod.TimesheetRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('TimesheetRepository.findByWeek', () => {
  it('returns the timesheet for (household, carer, week) when it exists', async () => {
    const row = { id: 'ts1', household_id: 'h1', carer_id: 'carer-1' };
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: row, error: null })
    );
    const repo = new TimesheetRepository();
    expect(await repo.findByWeek('h1', 'carer-1', '2026-08-03')).toEqual(row);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('timesheets');
  });

  it('returns null when no timesheet exists yet for that week', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimesheetRepository();
    expect(await repo.findByWeek('h1', 'carer-1', '2026-08-03')).toBeNull();
  });
});

describe('TimesheetRepository.listForHousehold', () => {
  it('lists a household timesheets, most recent week first', async () => {
    const rows = [{ id: 'ts1', household_id: 'h1' }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new TimesheetRepository();
    expect(await repo.listForHousehold('h1')).toEqual(rows);
  });

  it('returns [] when the query returns no rows', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimesheetRepository();
    expect(await repo.listForHousehold('h1')).toEqual([]);
  });
});
