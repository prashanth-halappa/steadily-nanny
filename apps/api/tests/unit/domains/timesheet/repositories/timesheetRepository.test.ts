import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let TimesheetRepository: any;
let mockSupabaseService: any;

function createMockQueryChain(
  finalResponse: { data: unknown; error: unknown } = { data: null, error: null }
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
      approved_by: 'parent-1',
      approved_at: '2026-08-10T09:00:00.000Z',
      gross_minor: 14_800,
      currency: 'GBP',
      earnings: { status: 'ok', gross_minor: 14_800 },
      earnings_computed_at: '2026-08-10T09:00:00.000Z',
    });
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
