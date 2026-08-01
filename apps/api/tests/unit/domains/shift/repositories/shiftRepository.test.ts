import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let ShiftRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    lt: mock(() => chain),
    gt: mock(() => chain),
    order: mock(() => chain),
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
    '../../../../../src/domains/shift/repositories/shiftRepository'
  );
  ShiftRepository = mod.ShiftRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('ShiftRepository.findByHouseholdAndRange', () => {
  it('lists shifts overlapping the range, each carrying its shift_children', async () => {
    const rows = [
      {
        id: 's1',
        household_id: 'h1',
        starts_at: '2026-08-03T08:00:00.000Z',
        ends_at: '2026-08-03T17:00:00.000Z',
        shift_children: [{ id: 'c1', child_id: 'child-1' }],
      },
    ];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new ShiftRepository();
    const result = await repo.findByHouseholdAndRange(
      'h1',
      '2026-08-01T00:00:00.000Z',
      '2026-08-08T00:00:00.000Z'
    );
    expect(result).toEqual(rows);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('shifts');
  });

  it('returns [] when nothing overlaps', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new ShiftRepository();
    expect(
      await repo.findByHouseholdAndRange(
        'h1',
        '2026-08-01T00:00:00.000Z',
        '2026-08-08T00:00:00.000Z'
      )
    ).toEqual([]);
  });
});

describe('ShiftRepository.findByIdWithChildren', () => {
  it('returns one shift with its children', async () => {
    const row = {
      id: 's1',
      household_id: 'h1',
      shift_children: [{ id: 'c1', child_id: 'child-1' }],
    };
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: row, error: null })
    );
    const repo = new ShiftRepository();
    expect(await repo.findByIdWithChildren('s1')).toEqual(row);
  });

  it('returns null when the shift does not exist', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new ShiftRepository();
    expect(await repo.findByIdWithChildren('missing')).toBeNull();
  });
});
