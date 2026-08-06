/**
 * The batch statements WS-J added to get `respond` off 26 seconds: each must
 * be ONE `from()` call whatever the row count, `createMany` must answer `null`
 * (never throw) on 062's window collision so the service can retry per row,
 * and every one of them must be a no-op on an empty list rather than an
 * unfiltered `IN ()`.
 *
 * `mock.module` inside `beforeAll`, before the dynamic import — see
 * docs/09-TESTING.md.
 *
 * @module tests/unit/domains/schedule/repositories/scheduleShiftRepository
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let ScheduleShiftRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    is: mock(() => chain),
    in: mock(() => chain),
    neq: mock(() => chain),
    limit: mock(() => Promise.resolve(finalResponse)),
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

/** The shape PostgREST hands back for a `shifts_recurring_window_unique` violation. */
const WINDOW_COLLISION = {
  code: '23505',
  message:
    'duplicate key value violates unique constraint "shifts_recurring_window_unique"',
  details: null,
};

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createMockQueryChain()) };
    return { supabase: obj, supabaseService: obj };
  });

  const mod = await import(
    '../../../../../src/domains/schedule/repositories/scheduleShiftRepository'
  );
  ScheduleShiftRepository = mod.ScheduleShiftRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

function shiftRow(index: number) {
  return {
    household_id: 'h1',
    carer_id: 'carer-1',
    starts_at: `2026-06-0${index}T07:00:00.000Z`,
    ends_at: `2026-06-0${index}T16:00:00.000Z`,
    timezone: 'Europe/London',
    kind: 'recurring' as const,
    status: 'confirmed' as const,
    source_pattern_id: 'p1',
    origin: 'system_generated' as const,
    note: null,
    ical_uid: `uid::2026-06-0${index}`,
  };
}

describe('ScheduleShiftRepository.createMany', () => {
  it('inserts every row in ONE statement and returns the created shifts', async () => {
    const created = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
    const chain = createMockQueryChain({ data: created, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new ScheduleShiftRepository();
    const rows = [shiftRow(1), shiftRow(2), shiftRow(3)];
    expect(await repo.createMany(rows)).toEqual(created);

    expect(mockSupabaseService.from).toHaveBeenCalledTimes(1);
    expect(chain.insert).toHaveBeenCalledWith(rows);
  });

  it('asks the DB nothing for an empty batch', async () => {
    const repo = new ScheduleShiftRepository();
    expect(await repo.createMany([])).toEqual([]);
    expect(mockSupabaseService.from).not.toHaveBeenCalled();
  });

  it('returns null (never throws) on 062`s window collision so the caller can retry per row', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: WINDOW_COLLISION })
    );
    const repo = new ScheduleShiftRepository();
    expect(await repo.createMany([shiftRow(1)])).toBeNull();
  });

  it('still throws on any OTHER database error — a null must only ever mean "window collision"', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: null,
        error: { code: '23505', message: 'shifts_ical_uid_key', details: null },
      })
    );
    const repo = new ScheduleShiftRepository();
    await expect(repo.createMany([shiftRow(1)])).rejects.toThrow(
      'Failed to create shifts'
    );
  });
});

describe('ScheduleShiftRepository batch reads and writes', () => {
  it('shiftIdsWithChangeRequests returns the set of ids in one query', async () => {
    const chain = createMockQueryChain({
      data: [{ shift_id: 's1' }, { shift_id: 's1' }, { shift_id: 's3' }],
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new ScheduleShiftRepository();
    const result = await repo.shiftIdsWithChangeRequests(['s1', 's2', 's3']);

    expect([...result].sort()).toEqual(['s1', 's3']);
    expect(mockSupabaseService.from).toHaveBeenCalledTimes(1);
    expect(chain.in).toHaveBeenCalledWith('shift_id', ['s1', 's2', 's3']);
  });

  // F-B6-4/expiry follow-up: `expired` means "nobody answered for 7 days"
  // (migration 064, F-B5-5), not "a human touched this shift" — unlike
  // withdrawn/declined, which DO represent human engagement and must keep
  // freezing the shift from re-materialisation (scheduleMaterialisationService.ts's
  // module doc).
  it('shiftIdsWithChangeRequests excludes expired requests from the probe', async () => {
    const chain = createMockQueryChain({ data: [], error: null });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new ScheduleShiftRepository();
    await repo.shiftIdsWithChangeRequests(['s1']);

    expect(chain.neq).toHaveBeenCalledWith('status', 'expired');
  });

  it('shiftIdsWithChangeRequests short-circuits on an empty list', async () => {
    const repo = new ScheduleShiftRepository();
    expect(await repo.shiftIdsWithChangeRequests([])).toEqual(new Set());
    expect(mockSupabaseService.from).not.toHaveBeenCalled();
  });

  it('updateMany applies one patch to every id in one statement', async () => {
    const chain = createMockQueryChain();
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new ScheduleShiftRepository();
    await repo.updateMany(['s1', 's2'], { status: 'cancelled' });

    expect(mockSupabaseService.from).toHaveBeenCalledTimes(1);
    expect(chain.update).toHaveBeenCalledWith({ status: 'cancelled' });
    expect(chain.in).toHaveBeenCalledWith('id', ['s1', 's2']);
  });

  it('updateMany and deleteMany never issue an unfiltered statement for an empty list', async () => {
    const repo = new ScheduleShiftRepository();
    await repo.updateMany([], { status: 'cancelled' });
    await repo.deleteMany([]);
    expect(mockSupabaseService.from).not.toHaveBeenCalled();
  });

  it('deleteMany removes every id in one statement', async () => {
    const chain = createMockQueryChain();
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new ScheduleShiftRepository();
    await repo.deleteMany(['s1', 's2']);

    expect(mockSupabaseService.from).toHaveBeenCalledTimes(1);
    expect(chain.in).toHaveBeenCalledWith('id', ['s1', 's2']);
  });

  it('replaceChildrenMany clears every shift`s children in one delete and inserts them all in one insert', async () => {
    const chain = createMockQueryChain();
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new ScheduleShiftRepository();
    await repo.replaceChildrenMany([
      {
        shiftId: 's1',
        children: [{ child_id: 'c1', starts_at: null, ends_at: null }],
      },
      {
        shiftId: 's2',
        children: [{ child_id: 'c2', starts_at: null, ends_at: null }],
      },
    ]);

    // Exactly two statements for the whole horizon: one delete, one insert.
    expect(mockSupabaseService.from).toHaveBeenCalledTimes(2);
    expect(chain.in).toHaveBeenCalledWith('shift_id', ['s1', 's2']);
    expect(chain.insert).toHaveBeenCalledWith([
      { shift_id: 's1', child_id: 'c1', starts_at: null, ends_at: null },
      { shift_id: 's2', child_id: 'c2', starts_at: null, ends_at: null },
    ]);
  });

  it('replaceChildrenMany still clears children when no shift has any, and skips the insert', async () => {
    const chain = createMockQueryChain();
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new ScheduleShiftRepository();
    await repo.replaceChildrenMany([{ shiftId: 's1', children: [] }]);

    expect(mockSupabaseService.from).toHaveBeenCalledTimes(1);
    expect(chain.insert).not.toHaveBeenCalled();
  });
});
