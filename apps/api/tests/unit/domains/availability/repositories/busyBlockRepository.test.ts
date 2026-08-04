import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let BusyBlockRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    lt: mock(() => chain),
    gt: mock(() => Promise.resolve(finalResponse)),
  };
  return chain;
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createMockQueryChain()) };
    return { supabase: obj, supabaseService: obj };
  });

  const mod = await import(
    '../../../../../src/domains/availability/repositories/busyBlockRepository'
  );
  BusyBlockRepository = mod.BusyBlockRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('BusyBlockRepository.listForCarer', () => {
  it('queries the v_busy_blocks view, scoped to the carer and the [from, to] window', async () => {
    const chain = createMockQueryChain({
      data: [
        {
          starts_at: '2026-08-03T09:00:00Z',
          ends_at: '2026-08-03T13:00:00Z',
          kind: 'other_commitment',
        },
      ],
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new BusyBlockRepository();
    const result = await repo.listForCarer(
      'carer-1',
      '2026-08-01T00:00:00Z',
      '2026-08-07T23:59:59Z'
    );

    expect(mockSupabaseService.from).toHaveBeenCalledWith('v_busy_blocks');
    expect(chain.select).toHaveBeenCalledWith('starts_at, ends_at, kind');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'carer-1');
    expect(chain.lt).toHaveBeenCalledWith('starts_at', '2026-08-07T23:59:59Z');
    expect(chain.gt).toHaveBeenCalledWith('ends_at', '2026-08-01T00:00:00Z');
    expect(result).toEqual([
      {
        starts_at: '2026-08-03T09:00:00Z',
        ends_at: '2026-08-03T13:00:00Z',
        kind: 'other_commitment',
      },
    ]);
  });

  it('returns [] when there are no blocks in the window', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new BusyBlockRepository();
    expect(await repo.listForCarer('carer-1', 'a', 'b')).toEqual([]);
  });

  it('throws DatabaseError on a query failure', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new BusyBlockRepository();
    await expect(repo.listForCarer('carer-1', 'a', 'b')).rejects.toThrow();
  });

  // --- THE privacy-shape test -----------------------------------------------
  // "Keep families apart" is a product privacy promise, not a nicety: this is
  // the ONLY code path that reads a carer's cross-household busy time, so its
  // output shape is the entire enforcement mechanism. Even though the query
  // builder already restricts the select to 3 columns (defense in depth #1,
  // asserted above), this test additionally proves the repository's mapping
  // step (defense in depth #2) strips any extra field a raw DB row could
  // still carry — e.g. if a future refactor widened the `.select()` string,
  // or a mocked/misconfigured client returned more than it was asked for.
  it('returns ONLY {starts_at, ends_at, kind} — never a household/user/child field — even if the raw row carries more', async () => {
    // Simulate a row that "leaked" extra columns from household A's data: a
    // household_id and a user_id riding along with the row, as would happen
    // if the view or a mock ever widened beyond the 3-column contract.
    const dirtyRowFromHouseholdA = {
      starts_at: '2026-08-03T09:00:00Z',
      ends_at: '2026-08-03T13:00:00Z',
      kind: 'other_commitment',
      source_uid: 'opaque-uid@steadily',
      household_id: 'household-A-secret',
      user_id: 'carer-1',
      child_id: 'child-A-secret',
      note: 'Dentist run for the Reyes kids',
    };
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: [dirtyRowFromHouseholdA], error: null })
    );

    const repo = new BusyBlockRepository();
    const [block] = await repo.listForCarer(
      'carer-1',
      '2026-08-01T00:00:00Z',
      '2026-08-07T23:59:59Z'
    );

    expect(Object.keys(block).sort()).toEqual(
      ['ends_at', 'kind', 'starts_at'].sort()
    );
    expect(block).toEqual({
      starts_at: '2026-08-03T09:00:00Z',
      ends_at: '2026-08-03T13:00:00Z',
      kind: 'other_commitment',
    });
    expect((block as Record<string, unknown>).source_uid).toBeUndefined();
    expect((block as Record<string, unknown>).household_id).toBeUndefined();
    expect((block as Record<string, unknown>).user_id).toBeUndefined();
    expect((block as Record<string, unknown>).child_id).toBeUndefined();
    expect((block as Record<string, unknown>).note).toBeUndefined();
  });
});

describe('BusyBlockRepository.listForClashEvaluation', () => {
  it('selects opaque source_uid for server-internal clash self-ignore', async () => {
    const chain = createMockQueryChain({
      data: [
        {
          starts_at: '2026-08-03T09:00:00Z',
          ends_at: '2026-08-03T13:00:00Z',
          kind: 'other_commitment',
          source_uid: 'shift-1@steadily',
          household_id: 'household-A-secret',
        },
      ],
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new BusyBlockRepository();
    const result = await repo.listForClashEvaluation(
      'carer-1',
      '2026-08-01T00:00:00Z',
      '2026-08-07T23:59:59Z'
    );

    expect(chain.select).toHaveBeenCalledWith(
      'starts_at, ends_at, kind, source_uid'
    );
    expect(result).toEqual([
      {
        starts_at: '2026-08-03T09:00:00Z',
        ends_at: '2026-08-03T13:00:00Z',
        kind: 'other_commitment',
        source_uid: 'shift-1@steadily',
      },
    ]);
    expect((result[0] as Record<string, unknown>).household_id).toBeUndefined();
  });
});
