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
    insert: mock(() => Promise.resolve(finalResponse)),
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

describe('ShiftEventRepository.listEventKeysForDate', () => {
  it('extracts payload.key from matching rows into a Set', async () => {
    const rows = [
      {
        payload: {
          key: 'c1|2026-08-03T09:00:00.000Z|2026-08-03T12:00:00.000Z',
        },
      },
      {
        payload: {
          key: 'c2|2026-08-03T09:00:00.000Z|2026-08-03T12:00:00.000Z',
        },
      },
    ];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new ShiftEventRepository();
    const result = await repo.listEventKeysForDate(
      'h1',
      '2026-08-03',
      'coverage_gap'
    );
    expect(result).toEqual(
      new Set([
        'c1|2026-08-03T09:00:00.000Z|2026-08-03T12:00:00.000Z',
        'c2|2026-08-03T09:00:00.000Z|2026-08-03T12:00:00.000Z',
      ])
    );
    expect(mockSupabaseService.from).toHaveBeenCalledWith('shift_events');
  });

  it('ignores rows with a missing or non-string key', async () => {
    const rows = [{ payload: {} }, { payload: { key: 42 } }, { payload: null }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new ShiftEventRepository();
    const result = await repo.listEventKeysForDate(
      'h1',
      '2026-08-03',
      'coverage_gap'
    );
    expect(result).toEqual(new Set());
  });

  it('returns an empty Set when there are no rows', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new ShiftEventRepository();
    const result = await repo.listEventKeysForDate(
      'h1',
      '2026-08-03',
      'coverage_gap'
    );
    expect(result).toEqual(new Set());
  });

  it('throws DatabaseError on failure', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new ShiftEventRepository();
    await expect(
      repo.listEventKeysForDate('h1', '2026-08-03', 'coverage_gap')
    ).rejects.toThrow();
  });
});

describe('ShiftEventRepository.insertMany', () => {
  it('inserts the given rows', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new ShiftEventRepository();
    const events = [
      {
        household_id: 'h1',
        shift_id: null,
        local_date: '2026-08-03',
        actor_id: null,
        event_type: 'coverage_gap',
        payload: { key: 'k1' },
      },
    ];
    await repo.insertMany(events);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('shift_events');
  });

  it('is a no-op for an empty array (does not touch the database)', async () => {
    const repo = new ShiftEventRepository();
    await repo.insertMany([]);
    expect(mockSupabaseService.from).not.toHaveBeenCalled();
  });

  it('throws DatabaseError on failure', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new ShiftEventRepository();
    await expect(
      repo.insertMany([
        {
          household_id: 'h1',
          shift_id: null,
          local_date: '2026-08-03',
          actor_id: null,
          event_type: 'coverage_gap',
          payload: { key: 'k1' },
        },
      ])
    ).rejects.toThrow();
  });
});
