import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let ShiftEventRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    order: mock(() => chain),
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
    '../../../../../src/domains/shift/repositories/shiftEventRepository'
  );
  ShiftEventRepository = mod.ShiftEventRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('ShiftEventRepository.listForShift', () => {
  it('lists the day thread for one shift, oldest first', async () => {
    const rows = [{ id: 'e1', shift_id: 's1', event_type: 'gap_raised' }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new ShiftEventRepository();
    const result = await repo.listForShift('h1', 's1');
    expect(result).toEqual(rows);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('shift_events');
  });

  it('returns [] when there are no events', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new ShiftEventRepository();
    expect(await repo.listForShift('h1', 's1')).toEqual([]);
  });
});

describe('ShiftEventRepository.listForHouseholdDate', () => {
  it('lists day-thread events for a household date including nullable shift_id, oldest first', async () => {
    const rows = [
      { id: 'e1', shift_id: null, event_type: 'gap_raised' },
      { id: 'e2', shift_id: 's1', event_type: 'shift_updated' },
    ];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new ShiftEventRepository();
    const result = await repo.listForHouseholdDate('h1', '2026-08-03');
    expect(result).toEqual(rows);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('shift_events');
  });
});
