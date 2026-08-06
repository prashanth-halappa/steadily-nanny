import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let TimeEntryRepository: any;
let AlreadyClockedInError: any;
let CancellationPaidAlreadyRecordedError: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown; count?: number | null } = {
    data: null,
    error: null,
  }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
    gte: mock(() => chain),
    lt: mock(() => chain),
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
    '../../../../../src/domains/timesheet/repositories/timeEntryRepository'
  );
  TimeEntryRepository = mod.TimeEntryRepository;
  const errors = await import(
    '../../../../../src/domains/timesheet/errors/timesheetErrors'
  );
  AlreadyClockedInError = errors.AlreadyClockedInError;
  CancellationPaidAlreadyRecordedError =
    errors.CancellationPaidAlreadyRecordedError;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('TimeEntryRepository.clockIn', () => {
  it('creates a running entry', async () => {
    const created = {
      id: 't1',
      carer_id: 'carer-1',
      carer_display_name: 'Nia Rowe',
      status: 'running',
    };
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: created, error: null })
    );
    const repo = new TimeEntryRepository();
    const result = await repo.clockIn({
      household_id: 'h1',
      carer_id: 'carer-1',
      carer_display_name: 'Nia Rowe',
      shift_id: null,
      clock_in_at: '2026-08-03T08:00:00.000Z',
      timezone: 'Europe/London',
      kind: 'worked',
      status: 'running',
    });
    expect(result).toEqual(created);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('time_entries');
  });

  it('translates a 23505 unique-violation into AlreadyClockedInError, not a raw 500', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      })
    );
    const repo = new TimeEntryRepository();
    await expect(
      repo.clockIn({
        household_id: 'h1',
        carer_id: 'carer-1',
        carer_display_name: 'Nia Rowe',
        shift_id: null,
        clock_in_at: '2026-08-03T08:00:00.000Z',
        timezone: 'Europe/London',
        kind: 'worked',
        status: 'running',
      })
    ).rejects.toBeInstanceOf(AlreadyClockedInError);
  });
});

describe('TimeEntryRepository.createSubmitted', () => {
  it('translates a cancellation_paid 23505 into CancellationPaidAlreadyRecordedError', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      })
    );
    const repo = new TimeEntryRepository();
    await expect(
      repo.createSubmitted({
        household_id: 'h1',
        carer_id: 'carer-1',
        carer_display_name: 'Nia Rowe',
        shift_id: 's1',
        clock_in_at: '2026-08-03T09:00:00.000Z',
        clock_out_at: '2026-08-03T17:00:00.000Z',
        break_minutes: 0,
        scheduled_minutes: 480,
        timezone: 'Europe/London',
        kind: 'cancellation_paid',
        status: 'submitted',
        note: null,
      })
    ).rejects.toBeInstanceOf(CancellationPaidAlreadyRecordedError);
  });
});

describe('TimeEntryRepository.findRunningForCarer', () => {
  it('returns the running entry when one exists', async () => {
    const running = { id: 't1', carer_id: 'carer-1', status: 'running' };
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: running, error: null })
    );
    const repo = new TimeEntryRepository();
    expect(await repo.findRunningForCarer('carer-1')).toEqual(running);
  });

  it('returns null when no entry is running', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimeEntryRepository();
    expect(await repo.findRunningForCarer('carer-1')).toBeNull();
  });
});

describe('TimeEntryRepository.hasTimeEntries', () => {
  it('returns true when at least one entry exists for the shift', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null, count: 2 })
    );
    const repo = new TimeEntryRepository();
    expect(await repo.hasTimeEntries('shift-1')).toBe(true);
  });

  it('returns false when the count is zero', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null, count: 0 })
    );
    const repo = new TimeEntryRepository();
    expect(await repo.hasTimeEntries('shift-1')).toBe(false);
  });

  it('returns false when count is null', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null, count: null })
    );
    const repo = new TimeEntryRepository();
    expect(await repo.hasTimeEntries('shift-1')).toBe(false);
  });
});

describe('TimeEntryRepository.listForHouseholdWeek', () => {
  it('lists a household week, newest clock-in first', async () => {
    const rows = [{ id: 't1', household_id: 'h1' }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new TimeEntryRepository();
    const result = await repo.listForHouseholdWeek(
      'h1',
      '2026-08-03',
      '2026-08-10'
    );
    expect(result).toEqual(rows);
  });

  it('returns [] when the query returns no rows', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimeEntryRepository();
    expect(
      await repo.listForHouseholdWeek('h1', '2026-08-03', '2026-08-10')
    ).toEqual([]);
  });

  // C1 (058). `household_member_id` appears NOWHERE in apps/api/src: it
  // reaches the parent's screen only because this read is `select('*')` and
  // nothing in between picks columns. That makes it silently droppable — a
  // future narrowed select here would leave two departed carers merging on
  // the client again, with no API test going red. This is that test.
  it('C1: keeps household_member_id on the rows it returns, and selects every column', async () => {
    const chain = createMockQueryChain({
      data: [{ id: 't1', household_id: 'h1', household_member_id: 'member-1' }],
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new TimeEntryRepository();
    const result = await repo.listForHouseholdWeek(
      'h1',
      '2026-08-03',
      '2026-08-10'
    );
    expect(result[0].household_member_id).toBe('member-1');
    expect(chain.select).toHaveBeenCalledWith('*');
  });
});

describe('TimeEntryRepository.listForCarerWeek', () => {
  it('lists one carer entries for the week, scoped to household + carer', async () => {
    const rows = [{ id: 't1', household_id: 'h1', carer_id: 'carer-1' }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new TimeEntryRepository();
    const result = await repo.listForCarerWeek(
      'h1',
      'carer-1',
      '2026-08-03',
      '2026-08-10'
    );
    expect(result).toEqual(rows);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('time_entries');
  });

  it('returns [] when the query returns no rows', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimeEntryRepository();
    expect(
      await repo.listForCarerWeek('h1', 'carer-1', '2026-08-03', '2026-08-10')
    ).toEqual([]);
  });
});

/**
 * The overlap and carer-scoping queries run against a STATEFUL fake chain that
 * actually evaluates eq/gte/lte/or against in-memory rows — a recording-only
 * chain passes even with an inverted predicate or a missing carer filter,
 * which is exactly what these tests exist to catch (F-B1-1, F-B1-3).
 */
interface FakeRow {
  [key: string]: unknown;
}

function matchesOrTerm(row: FakeRow, term: string): boolean {
  const [column, op, ...rest] = term.split('.');
  const value = rest.join('.');
  const actual = row[column as string];
  if (op === 'is') return value === 'null' ? actual === null : false;
  if (op === 'gte') return actual !== null && String(actual) >= value;
  if (op === 'lte') return actual !== null && String(actual) <= value;
  return false;
}

function createStatefulQuery(rows: FakeRow[], error: unknown = null): any {
  const predicates: ((row: FakeRow) => boolean)[] = [];
  const chain: any = {
    select: mock(() => chain),
    eq: mock((key: string, value: unknown) => {
      predicates.push(row => row[key] === value);
      return chain;
    }),
    gte: mock((key: string, value: unknown) => {
      predicates.push(row => String(row[key]) >= String(value));
      return chain;
    }),
    lte: mock((key: string, value: unknown) => {
      predicates.push(row => String(row[key]) <= String(value));
      return chain;
    }),
    lt: mock((key: string, value: unknown) => {
      predicates.push(row => String(row[key]) < String(value));
      return chain;
    }),
    or: mock((expression: string) => {
      const terms = expression.split(',');
      predicates.push(row => terms.some(term => matchesOrTerm(row, term)));
      return chain;
    }),
    order: mock(() => chain),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(
        error
          ? { data: null, error }
          : {
              data: rows.filter(row => predicates.every(p => p(row))),
              error: null,
            }
      ).then(resolve),
  };
  return chain;
}

const overnightPriorWeek: FakeRow = {
  id: 't-overnight',
  household_id: 'h1',
  carer_id: 'carer-1',
  clock_in_at: '2026-08-02T22:00:00.000Z',
  clock_out_at: '2026-08-03T05:00:00.000Z',
  local_date: '2026-08-02',
  status: 'submitted',
};
const mondayDay: FakeRow = {
  id: 't-monday',
  household_id: 'h1',
  carer_id: 'carer-1',
  clock_in_at: '2026-08-03T08:00:00.000Z',
  clock_out_at: '2026-08-03T16:00:00.000Z',
  local_date: '2026-08-03',
  status: 'submitted',
};
const stillRunning: FakeRow = {
  id: 't-running',
  household_id: 'h1',
  carer_id: 'carer-1',
  clock_in_at: '2026-08-04T09:00:00.000Z',
  clock_out_at: null,
  local_date: '2026-08-04',
  status: 'running',
};
const otherCarer: FakeRow = {
  ...mondayDay,
  id: 't-other-carer',
  carer_id: 'carer-2',
};
const otherHousehold: FakeRow = {
  ...mondayDay,
  id: 't-other-household',
  household_id: 'h2',
};

const allRows = [
  overnightPriorWeek,
  mondayDay,
  stillRunning,
  otherCarer,
  otherHousehold,
];

describe('TimeEntryRepository.listOverlapCandidatesForCarer', () => {
  it('finds an entry filed under the PREVIOUS week whose clock span still reaches into this one', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createStatefulQuery(allRows)
    );
    const repo = new TimeEntryRepository();

    const result = await repo.listOverlapCandidatesForCarer(
      'carer-1',
      '2026-08-03T01:00:00.000Z',
      '2026-08-03T03:00:00.000Z'
    );

    expect(result.map((r: FakeRow) => r.id)).toEqual(['t-overnight']);
  });

  it('catches an entry that STARTED before the window and ends inside it', async () => {
    // The half-covered case: `clock_in_at <= to` alone would miss nothing
    // here, but an inverted `clock_out_at` bound would — the finish sits
    // between `from` and `to`, not past either end.
    mockSupabaseService.from.mockImplementation(() =>
      createStatefulQuery(allRows)
    );
    const repo = new TimeEntryRepository();

    const result = await repo.listOverlapCandidatesForCarer(
      'carer-1',
      '2026-08-03T04:00:00.000Z',
      '2026-08-03T09:00:00.000Z'
    );

    // t-overnight ends 05:00 (inside the window); t-monday starts 08:00
    // (inside it too) — both genuinely collide with 04:00-09:00. The
    // other-household row is this same carer, so it collides as well.
    expect(result.map((r: FakeRow) => r.id).sort()).toEqual([
      't-monday',
      't-other-household',
      't-overnight',
    ]);
  });

  it('includes a still-running entry — it has no finish, so it is never filtered out by one', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createStatefulQuery(allRows)
    );
    const repo = new TimeEntryRepository();

    const result = await repo.listOverlapCandidatesForCarer(
      'carer-1',
      '2026-08-04T10:00:00.000Z',
      '2026-08-04T11:00:00.000Z'
    );

    expect(result.map((r: FakeRow) => r.id)).toEqual(['t-running']);
  });

  it('never returns another CARER rows', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createStatefulQuery(allRows)
    );
    const repo = new TimeEntryRepository();

    const result = await repo.listOverlapCandidatesForCarer(
      'carer-1',
      '2026-08-03T09:00:00.000Z',
      '2026-08-03T10:00:00.000Z'
    );

    expect(result.map((r: FakeRow) => r.id)).not.toContain('t-other-carer');
  });

  it('DOES return this carer rows in another household — she cannot be in two places at once', async () => {
    // `time_entries_one_running_per_carer` is keyed on carer_id with no
    // household predicate, so the DB already treats "on the clock" as
    // carer-global. Scoping overlap to one household would let the same hour
    // be double-booked across two families.
    mockSupabaseService.from.mockImplementation(() =>
      createStatefulQuery(allRows)
    );
    const repo = new TimeEntryRepository();

    const result = await repo.listOverlapCandidatesForCarer(
      'carer-1',
      '2026-08-03T09:00:00.000Z',
      '2026-08-03T10:00:00.000Z'
    );

    expect(result.map((r: FakeRow) => r.id).sort()).toEqual([
      't-monday',
      't-other-household',
    ]);
  });

  it('returns [] when nothing intersects the span', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createStatefulQuery(allRows)
    );
    const repo = new TimeEntryRepository();

    expect(
      await repo.listOverlapCandidatesForCarer(
        'carer-1',
        '2026-08-03T06:00:00.000Z',
        '2026-08-03T07:00:00.000Z'
      )
    ).toEqual([]);
  });
});

describe('TimeEntryRepository.listForHouseholdWeek — optional carer filter (F-B1-3)', () => {
  it('returns only the named carer entries when a carer is given', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createStatefulQuery(allRows)
    );
    const repo = new TimeEntryRepository();

    const result = await repo.listForHouseholdWeek(
      'h1',
      '2026-08-03',
      '2026-08-10',
      'carer-2'
    );

    expect(result.map((r: FakeRow) => r.id)).toEqual(['t-other-carer']);
  });

  it('returns every carer entries when no carer is given — unchanged behaviour', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createStatefulQuery(allRows)
    );
    const repo = new TimeEntryRepository();

    const result = await repo.listForHouseholdWeek(
      'h1',
      '2026-08-03',
      '2026-08-10'
    );

    expect(result.map((r: FakeRow) => r.id)).toEqual([
      't-monday',
      't-running',
      't-other-carer',
    ]);
  });
});
