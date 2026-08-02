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
    upsert: mock(() => Promise.resolve(finalResponse)),
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
  it('upserts the given rows with ignoreDuplicates and no onConflict', async () => {
    const chain = createMockQueryChain({ data: null, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
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
    expect(chain.upsert).toHaveBeenCalledWith(events, {
      ignoreDuplicates: true,
    });
    expect(chain.insert).not.toHaveBeenCalled();
    const upsertOptions = chain.upsert.mock.calls[0][1];
    // Deliberately omitting `onConflict`: migration 025
    // (supabase/migrations/025_shift_events_keyed_unique.sql) enforces the
    // dedupe with a PARTIAL EXPRESSION index —
    // `shift_events_keyed_unique_idx on (household_id, local_date,
    // event_type, (payload->>'key')) where (payload->>'key') is not null` —
    // and PostgREST's `onConflict` option only accepts a column-name list,
    // which cannot name an expression index. Omitting `onConflict` is what
    // makes PostgREST emit a bare `ON CONFLICT DO NOTHING`, which Postgres
    // resolves against ANY applicable unique/exclusion constraint or index,
    // including this partial expression one. Verified against the live
    // Supabase project on 2026-08-02: concurrent duplicate-keyed event
    // inserts are silently skipped (ignoreDuplicates behavior), no 23505
    // unique-violation error. If a future change adds an explicit
    // `onConflict` here (e.g. "helpfully" naming a column list), it will
    // NOT match this index and duplicate inserts will start raising 23505
    // at runtime — a regression this mocked test cannot see for you, since
    // the mock upsert chain doesn't enforce real constraint-matching.
    expect(upsertOptions).not.toHaveProperty('onConflict');
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
