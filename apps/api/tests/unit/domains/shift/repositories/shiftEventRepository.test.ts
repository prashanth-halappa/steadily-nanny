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
    // Chainable, not terminal: the 23505 fallback does
    // `.insert(event).select().single()` per row (F-B6-5 reopened).
    insert: mock(() => chain),
    single: mock(() => Promise.resolve(finalResponse)),
    // Chainable, not terminal: production code does `.upsert(...).select()`
    // to get back the rows Postgres actually inserted (F-B6-5).
    upsert: mock(() => chain),
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
    const chain = createMockQueryChain({ data: [], error: null });
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
    expect(chain.select).toHaveBeenCalled();
    expect(chain.insert).not.toHaveBeenCalled();
    const upsertOptions = chain.upsert.mock.calls[0][1];
    // `onConflict` is deliberately absent from this call, but that does NOT
    // make `ignoreDuplicates` cover migration 025's dedupe index. That index —
    // `shift_events_keyed_unique_idx on (household_id, local_date,
    // event_type, (payload->>'key')) where (payload->>'key') is not null` —
    // is a PARTIAL EXPRESSION index, and PostgREST's `onConflict` option only
    // accepts a column-name list, so there is no way to name it here at all.
    // CORRECTION (this comment previously claimed the opposite, citing an
    // unreproducible 2026-08-02 manual check against the live project):
    // verified against local PostgREST 14.15, a concurrent duplicate-keyed
    // insert 23505-THROWS the whole batch — it is NOT silently skipped.
    // `ignoreDuplicates` only covers a plain-column/PK conflict inline; the
    // expression-index case is handled by `insertMany`'s row-by-row fallback
    // below, not by this upsert call.
    expect(upsertOptions).not.toHaveProperty('onConflict');
  });

  it('is a no-op for an empty array (does not touch the database)', async () => {
    const repo = new ShiftEventRepository();
    expect(await repo.insertMany([])).toEqual([]);
    expect(mockSupabaseService.from).not.toHaveBeenCalled();
  });

  // F-B6-5: a caller (coverageGapService.raiseGapsOnce) needs to know which
  // rows IT genuinely created, not just that the statement succeeded —
  // `ON CONFLICT DO NOTHING RETURNING` only returns rows Postgres actually
  // inserted, which is what `.select()` on the upsert surfaces here.
  it('returns the rows Postgres actually inserted, absent whatever ignoreDuplicates suppressed', async () => {
    const createdRow = {
      id: 'e1',
      household_id: 'h1',
      shift_id: null,
      local_date: '2026-08-03',
      actor_id: null,
      event_type: 'coverage_gap',
      payload: { key: 'k1' },
      created_at: '2026-08-03T00:00:00.000Z',
    };
    // Two rows submitted; only one survives the conflict — RETURNING is
    // silent about the duplicate, it just isn't in `data`.
    const chain = createMockQueryChain({ data: [createdRow], error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new ShiftEventRepository();

    const result = await repo.insertMany([
      {
        household_id: 'h1',
        shift_id: null,
        local_date: '2026-08-03',
        actor_id: null,
        event_type: 'coverage_gap',
        payload: { key: 'k1' },
      },
      {
        household_id: 'h1',
        shift_id: null,
        local_date: '2026-08-03',
        actor_id: null,
        event_type: 'coverage_gap',
        payload: { key: 'k2 — already raised by a concurrent run' },
      },
    ]);

    expect(result).toEqual([createdRow]);
  });

  it('returns an empty array when every row was duplicate-suppressed', async () => {
    const chain = createMockQueryChain({ data: [], error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new ShiftEventRepository();

    const result = await repo.insertMany([
      {
        household_id: 'h1',
        shift_id: null,
        local_date: '2026-08-03',
        actor_id: null,
        event_type: 'coverage_gap',
        payload: { key: 'k1' },
      },
    ]);

    expect(result).toEqual([]);
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

  // F-B6-5 REOPENED: migration 025's dedupe index is a partial EXPRESSION
  // index, which `ignoreDuplicates` (no `onConflict`) cannot target — a
  // concurrent duplicate-keyed row 23505s the WHOLE batch instead of being
  // silently skipped, taking legitimately-new rows down with it. Same
  // wholesale-abort-then-retry-per-row shape as
  // `ScheduleShiftRepository.createMany` (GOLDEN-FIXES #28).
  describe('insertMany — 023505 fallback (migration 025 expression index)', () => {
    function rowInput(key: string): {
      household_id: string;
      shift_id: null;
      local_date: string;
      actor_id: null;
      event_type: string;
      payload: { key: string };
    } {
      return {
        household_id: 'h1',
        shift_id: null,
        local_date: '2026-08-03',
        actor_id: null,
        event_type: 'coverage_gap',
        payload: { key },
      };
    }

    const duplicateError = {
      code: '23505',
      message:
        'duplicate key value violates unique constraint "shift_events_keyed_unique_idx"',
    };

    it('retries row by row when the batch upsert 23505s, returning only the rows THIS call created', async () => {
      const winner = { id: 'e1', ...rowInput('k1') };
      // Call order: 1) the batch upsert (23505), 2) row 1's insert
      // (succeeds — nobody else has 'k1'), 3) row 2's insert (23505 — a
      // concurrent writer already raised 'k2').
      const chains = [
        createMockQueryChain({ data: null, error: duplicateError }),
        createMockQueryChain({ data: winner, error: null }),
        createMockQueryChain({ data: null, error: duplicateError }),
      ];
      let call = 0;
      mockSupabaseService.from.mockImplementation(() => chains[call++]);

      const repo = new ShiftEventRepository();
      const result = await repo.insertMany([rowInput('k1'), rowInput('k2')]);

      expect(result).toEqual([winner]);
      expect(mockSupabaseService.from).toHaveBeenCalledTimes(3);
      expect(chains[1]?.insert).toHaveBeenCalledWith(rowInput('k1'));
      expect(chains[2]?.insert).toHaveBeenCalledWith(rowInput('k2'));
    });

    it('returns an empty array when every row in the fallback loses to a concurrent writer', async () => {
      const chains = [
        createMockQueryChain({ data: null, error: duplicateError }),
        createMockQueryChain({ data: null, error: duplicateError }),
      ];
      let call = 0;
      mockSupabaseService.from.mockImplementation(() => chains[call++]);

      const repo = new ShiftEventRepository();
      const result = await repo.insertMany([rowInput('k1')]);

      expect(result).toEqual([]);
    });

    it('throws DatabaseError when a per-row fallback insert fails for a reason other than a duplicate', async () => {
      const chains = [
        createMockQueryChain({ data: null, error: duplicateError }),
        createMockQueryChain({
          data: null,
          error: { code: '55000', message: 'object not in prerequisite state' },
        }),
      ];
      let call = 0;
      mockSupabaseService.from.mockImplementation(() => chains[call++]);

      const repo = new ShiftEventRepository();
      await expect(repo.insertMany([rowInput('k1')])).rejects.toThrow();
    });

    // Matched on the CONSTRAINT NAME, not bare '23505' — a 23505 on some
    // OTHER unique index (hypothetical future one) is a real bug, not a lost
    // race, and must not be silently swallowed as "already exists".
    it('throws DatabaseError on a per-row 23505 that does not name the keyed unique index', async () => {
      const chains = [
        createMockQueryChain({ data: null, error: duplicateError }),
        createMockQueryChain({
          data: null,
          error: {
            code: '23505',
            message:
              'duplicate key value violates unique constraint "some_other_idx"',
          },
        }),
      ];
      let call = 0;
      mockSupabaseService.from.mockImplementation(() => chains[call++]);

      const repo = new ShiftEventRepository();
      await expect(repo.insertMany([rowInput('k1')])).rejects.toThrow();
    });
  });
});
