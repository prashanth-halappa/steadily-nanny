import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let TimesheetRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown; count?: number } = {
    data: null,
    error: null,
  }
): any {
  const chain: any = {
    select: mock(() => chain),
    eq: mock(() => chain),
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
    '../../../../../src/domains/timesheet/repositories/timesheetRepository'
  );
  TimesheetRepository = mod.TimesheetRepository;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

beforeEach(() => {
  mockSupabaseService.from.mockClear?.();
});

describe('TimesheetRepository.findByWeek', () => {
  it('returns the timesheet for (household, carer, week) when it exists', async () => {
    const row = { id: 'ts1', household_id: 'h1', carer_id: 'carer-1' };
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: row, error: null })
    );
    const repo = new TimesheetRepository();
    expect(await repo.findByWeek('h1', 'carer-1', '2026-08-03')).toEqual(row);
    expect(mockSupabaseService.from).toHaveBeenCalledWith('timesheets');
  });

  it('returns null when no timesheet exists yet for that week', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimesheetRepository();
    expect(await repo.findByWeek('h1', 'carer-1', '2026-08-03')).toBeNull();
  });
});

describe('TimesheetRepository.listForHousehold', () => {
  it('lists a household timesheets, most recent week first', async () => {
    const rows = [{ id: 'ts1', household_id: 'h1' }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new TimesheetRepository();
    expect(await repo.listForHousehold('h1')).toEqual(rows);
  });

  it('returns [] when the query returns no rows', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimesheetRepository();
    expect(await repo.listForHousehold('h1')).toEqual([]);
  });

  // C1 (058) — see the twin in timeEntryRepository.test.ts. The column has no
  // named mention anywhere in apps/api/src; `select('*')` is the entire reason
  // the parent's week screen can tell two departed carers apart.
  it('C1: keeps household_member_id on the rows it returns, and selects every column', async () => {
    const chain = createMockQueryChain({
      data: [
        { id: 'ts1', household_id: 'h1', household_member_id: 'member-1' },
      ],
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new TimesheetRepository();
    const rows = await repo.listForHousehold('h1');
    expect(rows[0].household_member_id).toBe('member-1');
    expect(chain.select).toHaveBeenCalledWith('*');
  });
});

// =============================================================================
// The conditional approve — the statement that makes "compute then freeze"
// safe against a concurrent roll-up (docs/11-MONEY.md §3, review finding 13).
// =============================================================================

const snapshotPatch = {
  approved_by: 'parent-1',
  approved_at: '2026-08-10T09:00:00.000Z',
  gross_minor: 14_800,
  currency: 'GBP',
  earnings: { status: 'ok', gross_minor: 14_800 },
  earnings_computed_at: '2026-08-10T09:00:00.000Z',
};

/** The `updated_at` of the row the service read BEFORE computing earnings. */
const READ_VERSION = '2026-08-10T08:59:12.123456+00:00';

describe('TimesheetRepository.approveSubmittedWithEarnings', () => {
  it('sets the status AND all four snapshot columns in a single update', async () => {
    const chain = createMockQueryChain({
      data: { id: 'ts1', status: 'approved' },
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new TimesheetRepository();
    await repo.approveSubmittedWithEarnings('ts1', snapshotPatch, READ_VERSION);

    expect(chain.update).toHaveBeenCalledTimes(1);
    expect(chain.update).toHaveBeenCalledWith({
      status: 'approved',
      query_note: null,
      reopen_reason: null,
      approved_by: 'parent-1',
      approved_at: '2026-08-10T09:00:00.000Z',
      gross_minor: 14_800,
      currency: 'GBP',
      earnings: { status: 'ok', gross_minor: 14_800 },
      earnings_computed_at: '2026-08-10T09:00:00.000Z',
    });
  });

  it('clears reopen_reason on approval — display state, not the audit trail', async () => {
    const chain = createMockQueryChain({
      data: { id: 'ts1', status: 'approved', reopen_reason: null },
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new TimesheetRepository();
    await repo.approveSubmittedWithEarnings('ts1', snapshotPatch, READ_VERSION);

    const [patch] = chain.update.mock.calls[0] as [Record<string, unknown>];
    expect(patch.reopen_reason).toBeNull();
    expect(patch.query_note).toBeNull();
  });

  it("constrains the update with `where status = 'submitted'` — the status arm of the CAS", async () => {
    const chain = createMockQueryChain({ data: { id: 'ts1' }, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new TimesheetRepository();
    await repo.approveSubmittedWithEarnings('ts1', snapshotPatch, READ_VERSION);

    expect(chain.eq).toHaveBeenCalledWith('id', 'ts1');
    expect(chain.eq).toHaveBeenCalledWith('status', 'submitted');
  });

  // -------------------------------------------------------------------------
  // Phase 2 review, finding 1 (SHIP-BLOCKER). Status alone is not a version.
  // `rollUpIntoTimesheet` bumps `total_minutes` on an already-`submitted` week
  // WITHOUT touching `status`, so a status-only predicate cannot see it: the
  // parent approves 20h/£370.00, the nanny's clock-out lands 8h more, and the
  // CAS still matches and stamps `approved` over 28h of hours with the 20h
  // figure frozen on the row. The row version has to be in the predicate too.
  // -------------------------------------------------------------------------
  it('ALSO constrains the update on the row version the earnings were computed from', async () => {
    const chain = createMockQueryChain({ data: { id: 'ts1' }, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new TimesheetRepository();
    await repo.approveSubmittedWithEarnings('ts1', snapshotPatch, READ_VERSION);

    expect(chain.eq).toHaveBeenCalledWith('updated_at', READ_VERSION);
    // id + status + updated_at, and nothing else.
    expect(chain.eq).toHaveBeenCalledTimes(3);
  });

  it('never writes the version predicate as a COLUMN — it is a where, not a set', async () => {
    const chain = createMockQueryChain({ data: { id: 'ts1' }, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new TimesheetRepository();
    await repo.approveSubmittedWithEarnings('ts1', snapshotPatch, READ_VERSION);

    const [patch] = chain.update.mock.calls[0] as [Record<string, unknown>];
    expect(patch).not.toHaveProperty('updated_at');
    expect(patch).not.toHaveProperty('expectedUpdatedAt');
  });

  it('returns null when zero rows matched — the week changed under the approve', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimesheetRepository();
    expect(
      await repo.approveSubmittedWithEarnings(
        'ts1',
        snapshotPatch,
        READ_VERSION
      )
    ).toBeNull();
  });

  it('raises a DatabaseError rather than returning a half-written row', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new TimesheetRepository();
    await expect(
      repo.approveSubmittedWithEarnings('ts1', snapshotPatch, READ_VERSION)
    ).rejects.toThrow('Failed to approve timesheet with earnings');
  });
});

// =============================================================================
// The other two status transitions a parent drives — `query` and `reopen` —
// carry the SAME two-part predicate (1-E/P6). Both are decided against a row
// the service read earlier, and both overwrite state a concurrent roll-up or
// approve may have replaced in between, so status alone is no more of a
// version here than it is for approve.
//
// The predicate is an `.eq` on the exact string the DB handed back, never a
// parsed instant, so whichever serialisation the driver returns is the one
// that goes back out (GOLDEN-FIXES #25) — both are exercised below.
// =============================================================================

const READ_VERSIONS = [
  '2026-08-10T08:59:12.123456+00:00',
  '2026-08-10T08:59:12.123Z',
];

describe('TimesheetRepository.queryFromSubmitted', () => {
  it('sets the status and the note in a single update', async () => {
    const chain = createMockQueryChain({
      data: { id: 'ts1', status: 'queried' },
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new TimesheetRepository();
    await repo.queryFromSubmitted('ts1', READ_VERSIONS[0], 'Query Thursday');

    expect(chain.update).toHaveBeenCalledTimes(1);
    expect(chain.update).toHaveBeenCalledWith({
      status: 'queried',
      query_note: 'Query Thursday',
    });
  });

  for (const version of READ_VERSIONS) {
    it(`constrains the update on the submitted status AND the row version (${version})`, async () => {
      const chain = createMockQueryChain({ data: { id: 'ts1' }, error: null });
      mockSupabaseService.from.mockImplementation(() => chain);

      const repo = new TimesheetRepository();
      await repo.queryFromSubmitted('ts1', version, 'Query Thursday');

      expect(chain.eq).toHaveBeenCalledWith('id', 'ts1');
      expect(chain.eq).toHaveBeenCalledWith('status', 'submitted');
      expect(chain.eq).toHaveBeenCalledWith('updated_at', version);
      expect(chain.eq).toHaveBeenCalledTimes(3);
    });
  }

  it('never writes the version predicate as a COLUMN — it is a where, not a set', async () => {
    const chain = createMockQueryChain({ data: { id: 'ts1' }, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new TimesheetRepository();
    await repo.queryFromSubmitted('ts1', READ_VERSIONS[0], 'Query Thursday');

    const [patch] = chain.update.mock.calls[0] as [Record<string, unknown>];
    expect(patch).not.toHaveProperty('updated_at');
  });

  it('returns null when zero rows matched — the week changed under the query', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimesheetRepository();
    expect(
      await repo.queryFromSubmitted('ts1', READ_VERSIONS[0], 'Query Thursday')
    ).toBeNull();
  });

  it('raises a DatabaseError rather than looking like a lost race', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new TimesheetRepository();
    await expect(
      repo.queryFromSubmitted('ts1', READ_VERSIONS[0], 'Query Thursday')
    ).rejects.toThrow('Failed to query timesheet');
  });
});

describe('TimesheetRepository.reopenFromApproved', () => {
  it('clears all four snapshot columns and the approval stamp in the SAME write', async () => {
    const chain = createMockQueryChain({
      data: { id: 'ts1', status: 'submitted' },
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new TimesheetRepository();
    await repo.reopenFromApproved(
      'ts1',
      READ_VERSIONS[0],
      'Thursday was wrong'
    );

    expect(chain.update).toHaveBeenCalledTimes(1);
    expect(chain.update).toHaveBeenCalledWith({
      status: 'submitted',
      approved_by: null,
      approved_at: null,
      reopen_reason: 'Thursday was wrong',
      gross_minor: null,
      currency: null,
      earnings: null,
      earnings_computed_at: null,
    });
  });

  it('leaves query_note alone — an undo-approve is not an open dispute', async () => {
    const chain = createMockQueryChain({ data: { id: 'ts1' }, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new TimesheetRepository();
    await repo.reopenFromApproved('ts1', READ_VERSIONS[0], 'missed break');

    const [patch] = chain.update.mock.calls[0] as [Record<string, unknown>];
    expect(patch).not.toHaveProperty('query_note');
  });

  for (const version of READ_VERSIONS) {
    it(`constrains the update on the approved status AND the row version (${version})`, async () => {
      const chain = createMockQueryChain({ data: { id: 'ts1' }, error: null });
      mockSupabaseService.from.mockImplementation(() => chain);

      const repo = new TimesheetRepository();
      await repo.reopenFromApproved('ts1', version, 'missed break');

      expect(chain.eq).toHaveBeenCalledWith('id', 'ts1');
      expect(chain.eq).toHaveBeenCalledWith('status', 'approved');
      expect(chain.eq).toHaveBeenCalledWith('updated_at', version);
      expect(chain.eq).toHaveBeenCalledTimes(3);
    });
  }

  it('returns null when zero rows matched — the week changed under the reopen', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimesheetRepository();
    expect(
      await repo.reopenFromApproved('ts1', READ_VERSIONS[0], 'missed break')
    ).toBeNull();
  });

  it('raises a DatabaseError rather than leaving a half-cleared snapshot unreported', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new TimesheetRepository();
    await expect(
      repo.reopenFromApproved('ts1', READ_VERSIONS[0], 'missed break')
    ).rejects.toThrow('Failed to reopen timesheet');
  });
});

describe('TimesheetRepository.existsForHousehold', () => {
  it('returns true when the household has at least one timesheet', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null, count: 3 })
    );
    const repo = new TimesheetRepository();
    expect(await repo.existsForHousehold('h1')).toBe(true);
  });

  it('returns false when the household has no timesheets', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null, count: 0 })
    );
    const repo = new TimesheetRepository();
    expect(await repo.existsForHousehold('h1')).toBe(false);
  });

  it('scopes the count to the given household', async () => {
    const chain = createMockQueryChain({ data: null, error: null, count: 0 });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new TimesheetRepository();
    await repo.existsForHousehold('h1');
    expect(chain.eq).toHaveBeenCalledWith('household_id', 'h1');
  });

  it('raises a DatabaseError rather than returning a wrong existence answer', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new TimesheetRepository();
    await expect(repo.existsForHousehold('h1')).rejects.toThrow(
      'Failed to check timesheets for household'
    );
  });
});

describe('CLEARED_EARNINGS_SNAPSHOT', () => {
  it('names all four columns, so the reopen path cannot forget one', async () => {
    const { CLEARED_EARNINGS_SNAPSHOT } = await import(
      '../../../../../src/domains/timesheet/repositories/timesheetRepository'
    );
    expect(CLEARED_EARNINGS_SNAPSHOT).toEqual({
      gross_minor: null,
      currency: null,
      earnings: null,
      earnings_computed_at: null,
    });
  });
});

/**
 * Stateful fake chain — a recording-only chain would pass with a carer filter
 * that never reaches the query, which is the whole point of F-B1-3.
 */
interface FakeTimesheetRow {
  [key: string]: unknown;
}

function createStatefulQuery(rows: FakeTimesheetRow[]): any {
  const predicates: ((row: FakeTimesheetRow) => boolean)[] = [];
  const chain: any = {
    select: mock(() => chain),
    eq: mock((key: string, value: unknown) => {
      predicates.push(row => row[key] === value);
      return chain;
    }),
    order: mock(() => chain),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({
        data: rows.filter(row => predicates.every(p => p(row))),
        error: null,
      }).then(resolve),
  };
  return chain;
}

const carerOneWeek: FakeTimesheetRow = {
  id: 'ts1',
  household_id: 'h1',
  carer_id: 'carer-1',
  week_start: '2026-08-03',
};
const carerTwoWeek: FakeTimesheetRow = {
  id: 'ts2',
  household_id: 'h1',
  carer_id: 'carer-2',
  week_start: '2026-08-03',
};

describe('TimesheetRepository.listForHousehold — optional carer filter (F-B1-3)', () => {
  it('returns only the named carer weeks when a carer is given', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createStatefulQuery([carerOneWeek, carerTwoWeek])
    );
    const repo = new TimesheetRepository();

    const result = await repo.listForHousehold('h1', 'carer-2');

    expect(result.map((r: FakeTimesheetRow) => r.id)).toEqual(['ts2']);
  });

  it('returns every carer weeks when no carer is given — unchanged behaviour', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createStatefulQuery([carerOneWeek, carerTwoWeek])
    );
    const repo = new TimesheetRepository();

    const result = await repo.listForHousehold('h1');

    expect(result.map((r: FakeTimesheetRow) => r.id)).toEqual(['ts1', 'ts2']);
  });
});
