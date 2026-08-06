import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

interface FakeRow {
  [key: string]: unknown;
}

let ShiftRepository: any;
let mockSupabaseService: any;
let ShiftImmutableError: any;
let ShiftNotFoundError: any;
let DatabaseError: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    lt: mock(() => chain),
    gt: mock(() => chain),
    gte: mock(() => chain),
    not: mock(() => chain),
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
  DatabaseError = (await import('../../../../../src/errors')).DatabaseError;
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

describe('ShiftRepository.listCancellationPaidSince', () => {
  // Feeds the reconcile job, which re-drives a PAYABLE write. A shift with no
  // carer can never be paid (`recordCancellationPaidEntry` returns null early),
  // so fetching one would make the sweep "repair" it on every run forever.
  it('asks only for cancelled, paid, assigned shifts in the window', async () => {
    const chain = createMockQueryChain({ data: [], error: null });
    mockSupabaseService.from.mockImplementation(() => chain);

    await new ShiftRepository().listCancellationPaidSince(
      '2026-07-06T00:00:00.000Z'
    );

    expect(chain.eq).toHaveBeenCalledWith('cancellation_paid', true);
    expect(chain.eq).toHaveBeenCalledWith('status', 'cancelled');
    expect(chain.not).toHaveBeenCalledWith('carer_id', 'is', null);
    expect(chain.gte).toHaveBeenCalledWith(
      'starts_at',
      '2026-07-06T00:00:00.000Z'
    );
  });
});

/**
 * This one gets a STATEFUL chain rather than the recording-only
 * `createMockQueryChain` above. `findExtraShiftInWindow` is the whole
 * correctness of `insertExtraShift`'s retry guard: every predicate it drops
 * either swallows a legitimate new shift or lets the duplicate through, and a
 * chain that only records calls would pass with any of them missing.
 */
function createFakeShiftQuery(rows: FakeRow[], error: unknown = null): any {
  const eqFilters: [string, unknown][] = [];
  const neqFilters: [string, unknown][] = [];
  const isFilters: [string, unknown][] = [];
  let cap = Number.POSITIVE_INFINITY;

  // SQL three-valued logic, because that is the whole point of the `is` branch:
  // `.eq(col, null)` renders as `col=eq.null` and matches NOTHING, and a
  // `.neq`/`.eq` against a NULL column is UNKNOWN, not true. A fake that used
  // plain `===` here would happily accept `.eq('carer_id', null)`.
  const matches = (row: FakeRow): boolean =>
    eqFilters.every(
      ([key, value]) =>
        value !== null && row[key] !== null && row[key] === value
    ) &&
    neqFilters.every(
      ([key, value]) =>
        value !== null && row[key] !== null && row[key] !== value
    ) &&
    isFilters.every(([key, value]) => (row[key] ?? null) === value);

  const chain: any = {
    select: mock(() => chain),
    eq: mock((key: string, value: unknown) => {
      eqFilters.push([key, value]);
      return chain;
    }),
    neq: mock((key: string, value: unknown) => {
      neqFilters.push([key, value]);
      return chain;
    }),
    is: mock((key: string, value: unknown) => {
      isFilters.push([key, value]);
      return chain;
    }),
    limit: mock((n: number) => {
      cap = n;
      return chain;
    }),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(
        error
          ? { data: null, error }
          : { data: rows.filter(matches).slice(0, cap), error: null }
      ).then(resolve),
  };
  return chain;
}

describe('ShiftRepository.findExtraShiftInWindow', () => {
  const window = {
    starts_at: '2026-08-04T08:00:00.000Z',
    ends_at: '2026-08-04T12:00:00.000Z',
  };

  function extraShift(overrides: FakeRow = {}): FakeRow {
    return {
      id: 's-extra',
      household_id: 'h1',
      carer_id: 'carer-1',
      kind: 'extra',
      status: 'pending',
      ...window,
      shift_children: [],
      ...overrides,
    };
  }

  function find(
    rows: FakeRow[],
    carerId: string | null = 'carer-1'
  ): Promise<unknown> {
    mockSupabaseService.from.mockImplementation(() =>
      createFakeShiftQuery(rows)
    );
    return new ShiftRepository().findExtraShiftInWindow(
      'h1',
      carerId,
      window.starts_at,
      window.ends_at
    );
  }

  it('finds the live extra shift already covering this carer and window', async () => {
    const row = extraShift();
    expect(await find([row])).toEqual(row);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('shifts');
  });

  // Without `.neq('status', 'cancelled')` the guard reports a called-off shift
  // as the duplicate and the parent's replacement proposal silently vanishes.
  it('ignores a cancelled shift in the same window', async () => {
    expect(await find([extraShift({ status: 'cancelled' })])).toBeNull();
  });

  // Without `.eq('kind', 'extra')` a recurring shift in the same window would
  // be returned as the duplicate, so the extra shift never gets created.
  it('ignores a non-extra shift in the same window', async () => {
    expect(await find([extraShift({ kind: 'recurring' })])).toBeNull();
  });

  // `.eq('carer_id', null)` is not `.is('carer_id', null)` in PostgREST — the
  // former never matches, so every retry of an UNASSIGNED extra shift would
  // miss the guard and create another one.
  it('matches an unassigned extra shift only via the null-carer branch', async () => {
    const unassigned = extraShift({ id: 's-open', carer_id: null });
    expect(await find([extraShift(), unassigned], null)).toEqual(unassigned);
  });

  it('does not match another household or a different window', async () => {
    expect(await find([extraShift({ household_id: 'h2' })])).toBeNull();
    expect(
      await find([extraShift({ ends_at: '2026-08-04T13:00:00.000Z' })])
    ).toBeNull();
  });

  it('throws DatabaseError when the lookup fails', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createFakeShiftQuery([], { message: 'boom' })
    );
    expect(
      new ShiftRepository().findExtraShiftInWindow(
        'h1',
        'carer-1',
        window.starts_at,
        window.ends_at
      )
    ).rejects.toThrow(DatabaseError);
  });
});
