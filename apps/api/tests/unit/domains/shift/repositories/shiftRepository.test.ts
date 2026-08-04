import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let ShiftRepository: any;
let mockSupabaseService: any;
let ShiftImmutableError: any;
let ShiftNotFoundError: any;

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
  const errors = await import(
    '../../../../../src/domains/shift/errors/shiftErrors'
  );
  ShiftImmutableError = errors.ShiftImmutableError;
  ShiftNotFoundError = errors.ShiftNotFoundError;
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

describe('ShiftRepository.findByHouseholdAndLocalDate', () => {
  it('lists the household local calendar date shifts with their children', async () => {
    const rows = [
      {
        id: 's1',
        household_id: 'h1',
        local_date: '2026-08-03',
        shift_children: [{ id: 'c1', child_id: 'child-1' }],
      },
    ];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new ShiftRepository();
    expect(await repo.findByHouseholdAndLocalDate('h1', '2026-08-03')).toEqual(
      rows
    );
    expect(mockSupabaseService.from).toHaveBeenCalledWith('shifts');
  });

  it('returns [] when the household has no shift that day', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new ShiftRepository();
    expect(await repo.findByHouseholdAndLocalDate('h1', '2026-08-03')).toEqual(
      []
    );
  });
});

describe('ShiftRepository.update — immutability guard', () => {
  function makeTimeEntryRepo(hasTimeEntries = false): any {
    return { hasTimeEntries: mock(async () => hasTimeEntries) };
  }

  it('updates a confirmed shift with no time entries', async () => {
    const row = { id: 's1', status: 'confirmed' };
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: row, error: null })
    );
    const repo = new ShiftRepository(makeTimeEntryRepo(false));
    expect(await repo.update('s1', { note: 'hi' })).toEqual(row);
  });

  it('refuses to mutate a COMPLETED shift', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: { id: 's1', status: 'completed' },
        error: null,
      })
    );
    const repo = new ShiftRepository(makeTimeEntryRepo(false));
    await expect(
      repo.update('s1', { starts_at: '2026-08-03T09:00:00.000Z' })
    ).rejects.toBeInstanceOf(ShiftImmutableError);
  });

  it('refuses to mutate a CANCELLED shift', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: { id: 's1', status: 'cancelled' },
        error: null,
      })
    );
    const repo = new ShiftRepository(makeTimeEntryRepo(false));
    await expect(repo.update('s1', { note: 'x' })).rejects.toBeInstanceOf(
      ShiftImmutableError
    );
  });

  it('refuses to mutate an open shift that someone has clocked into', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: { id: 's1', status: 'confirmed' },
        error: null,
      })
    );
    const repo = new ShiftRepository(makeTimeEntryRepo(true));
    await expect(repo.update('s1', { note: 'x' })).rejects.toBeInstanceOf(
      ShiftImmutableError
    );
  });

  it('throws ShiftNotFoundError when the shift is gone', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new ShiftRepository(makeTimeEntryRepo(false));
    await expect(repo.update('missing', { note: 'x' })).rejects.toBeInstanceOf(
      ShiftNotFoundError
    );
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

describe('ShiftRepository.confirmPending — CAS pending → confirmed', () => {
  function makeTimeEntryRepo(hasTimeEntries = false): any {
    return { hasTimeEntries: mock(async () => hasTimeEntries) };
  }

  it('confirms when status is still pending', async () => {
    const pending = { id: 's1', status: 'pending' };
    const confirmed = { id: 's1', status: 'confirmed' };
    let call = 0;
    mockSupabaseService.from.mockImplementation(() => {
      call += 1;
      // assertMutable findById, then CAS update+.maybeSingle
      if (call === 1) {
        return createMockQueryChain({ data: pending, error: null });
      }
      return createMockQueryChain({ data: confirmed, error: null });
    });

    const repo = new ShiftRepository(makeTimeEntryRepo(false));
    expect(await repo.confirmPending('s1')).toEqual(confirmed);
  });

  it('throws SHIFT_NOT_PENDING ValidationError when the CAS update matches 0 rows', async () => {
    const { ValidationError } = await import('../../../../../src/errors');
    const pending = { id: 's1', status: 'pending' };
    let call = 0;
    mockSupabaseService.from.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return createMockQueryChain({ data: pending, error: null });
      }
      // Lost race: concurrent cancel/accept already moved status off pending.
      return createMockQueryChain({ data: null, error: null });
    });

    const repo = new ShiftRepository(makeTimeEntryRepo(false));
    try {
      await repo.confirmPending('s1');
      expect.unreachable('confirmPending should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      // ValidationError's machine code is always VALIDATION_ERROR; the CAS
      // reason lives in metadata.reason (see ValidationError constructor).
      expect(
        (error as InstanceType<typeof ValidationError>).metadata?.reason
      ).toBe('SHIFT_NOT_PENDING');
    }
  });
});
