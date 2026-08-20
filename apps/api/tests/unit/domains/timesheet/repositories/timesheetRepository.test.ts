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
    in: mock(() => chain),
    lt: mock(() => chain),
    not: mock(() => chain),
    limit: mock(() => chain),
    order: mock(() => chain),
    insert: mock(() => chain),
    update: mock(() => chain),
    is: mock(() => chain),
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
    const obj = {
      from: mock(() => createMockQueryChain()),
      // `roll_up_timesheet_hours` (102) is reached through `.rpc(...).single()`,
      // so the stub has to be the same chain shape a PostgREST builder is.
      rpc: mock(() => createMockQueryChain()),
    };
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
  mockSupabaseService.rpc.mockClear?.();
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

// §11.1.1's trailing-four-week median baseline for the "nothing unusual this
// week" fast path (`nothingUnusualService.ts`).
describe('TimesheetRepository.recentApprovedGross', () => {
  it('returns the frozen gross_minor values, most recent week first', async () => {
    const rows = [{ gross_minor: 15_400 }, { gross_minor: 15_600 }];
    const chain = createMockQueryChain({ data: rows, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const repo = new TimesheetRepository();
    const result = await repo.recentApprovedGross(
      'h1',
      'carer-1',
      '2026-08-10',
      4
    );
    expect(result).toEqual([15_400, 15_600]);
    expect(chain.eq).toHaveBeenCalledWith('status', 'approved');
    expect(chain.lt).toHaveBeenCalledWith('week_start', '2026-08-10');
    expect(chain.limit).toHaveBeenCalledWith(4);
  });

  it('drops legacy rows with a NULL gross_minor rather than treating them as zero', async () => {
    const rows = [{ gross_minor: 15_400 }, { gross_minor: null }];
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: rows, error: null })
    );
    const repo = new TimesheetRepository();
    const result = await repo.recentApprovedGross(
      'h1',
      'carer-1',
      '2026-08-10',
      4
    );
    expect(result).toEqual([15_400]);
  });

  it('returns [] when there is no history yet', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimesheetRepository();
    expect(
      await repo.recentApprovedGross('h1', 'carer-1', '2026-08-10', 4)
    ).toEqual([]);
  });
});

// =============================================================================
// The conditional approve — the statement that makes "compute then freeze"
// safe against a concurrent roll-up (docs/11-MONEY.md §3, review finding 13).
// =============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_SNAPSHOT_AT = new Date(Date.now() - 2 * DAY_MS).toISOString();
const readVersionInstant = new Date(Date.now() - 2 * DAY_MS);
readVersionInstant.setUTCHours(8, 59, 12, 123);

const snapshotPatch = {
  approved_by: 'parent-1',
  approved_at: FIXTURE_SNAPSHOT_AT,
  gross_minor: 14_800,
  currency: 'GBP',
  earnings: { status: 'ok', gross_minor: 14_800 },
  earnings_computed_at: FIXTURE_SNAPSHOT_AT,
};

/**
 * The approved row 111's receipt pre-read finds. `reopenFromApproved` reads
 * the row before it writes, because a PostgREST update has no `OLD` to
 * reference the way `roll_up_timesheet_hours` does.
 */
const approvedRow = {
  id: 'ts1',
  status: 'approved',
  approved_by: 'parent-1',
  approved_at: FIXTURE_SNAPSHOT_AT,
  gross_minor: 14_800,
  currency: 'GBP',
  earnings: { status: 'ok', gross_minor: 14_800, worked_minutes: 480 },
  earnings_computed_at: FIXTURE_SNAPSHOT_AT,
};

/**
 * Two chains, in call order: `from()` #1 is the receipt pre-read, #2 is the
 * conditional update. One shared stub would feed the update's own response
 * back into the pre-read, which is not a shape the database can produce.
 */
function mockReopenChains(
  readRow: unknown,
  updateResponse: { data: unknown; error: unknown }
): any {
  const updateChain = createMockQueryChain(updateResponse);
  let call = 0;
  mockSupabaseService.from.mockImplementation(() => {
    call += 1;
    return call === 1
      ? createMockQueryChain({ data: readRow, error: null })
      : updateChain;
  });
  return updateChain;
}

/** The `updated_at` of the row the service read BEFORE computing earnings. */
const READ_VERSION = readVersionInstant
  .toISOString()
  .replace('.123Z', '.123456+00:00');

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
      hours_changed_after_payment_at: null,
      // 111: this approval SUPERSEDES the receipt for the one the week lost.
      previous_approval: null,
      approved_by: 'parent-1',
      approved_at: FIXTURE_SNAPSHOT_AT,
      gross_minor: 14_800,
      currency: 'GBP',
      earnings: { status: 'ok', gross_minor: 14_800 },
      earnings_computed_at: FIXTURE_SNAPSHOT_AT,
    });
  });

  it('clears hours_changed_after_payment_at — this approval covers the added hours (102)', async () => {
    // Same stale-note class as `query_note` and `reopen_reason`: the flag says
    // "the approved total no longer covers every hour worked", and the parent
    // has just looked at the new total and signed it off. Leaving it set would
    // keep both week views telling a story about a figure that now includes
    // those hours.
    const chain = createMockQueryChain({
      data: { id: 'ts1', status: 'approved' },
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);

    await new TimesheetRepository().approveSubmittedWithEarnings(
      'ts1',
      snapshotPatch,
      READ_VERSION
    );

    expect(chain.update.mock.calls[0][0]).toHaveProperty(
      'hours_changed_after_payment_at',
      null
    );
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
  READ_VERSION,
  `${readVersionInstant.toISOString().slice(0, 23)}Z`,
];

describe('TimesheetRepository.queryFromActionable', () => {
  it('sets the status and the note in a single update', async () => {
    const chain = createMockQueryChain({
      data: { id: 'ts1', status: 'queried' },
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new TimesheetRepository();
    await repo.queryFromActionable('ts1', READ_VERSIONS[0], 'Query Thursday');

    expect(chain.update).toHaveBeenCalledTimes(1);
    expect(chain.update).toHaveBeenCalledWith({
      status: 'queried',
      query_note: 'Query Thursday',
    });
  });

  for (const version of READ_VERSIONS) {
    // The status predicate is an `in`, not an `eq`, since D-19: a NEW query
    // supersedes rather than blocks, so `queried` is a legal FROM state as
    // well as the destination. The version predicate is unchanged and still
    // the thing that makes the write safe.
    it(`constrains the update on the queryable statuses AND the row version (${version})`, async () => {
      const chain = createMockQueryChain({ data: { id: 'ts1' }, error: null });
      mockSupabaseService.from.mockImplementation(() => chain);

      const repo = new TimesheetRepository();
      await repo.queryFromActionable('ts1', version, 'Query Thursday');

      expect(chain.eq).toHaveBeenCalledWith('id', 'ts1');
      expect(chain.in).toHaveBeenCalledWith('status', ['submitted', 'queried']);
      expect(chain.eq).toHaveBeenCalledWith('updated_at', version);
      expect(chain.eq).toHaveBeenCalledTimes(2);
    });
  }

  it('never writes the version predicate as a COLUMN — it is a where, not a set', async () => {
    const chain = createMockQueryChain({ data: { id: 'ts1' }, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new TimesheetRepository();
    await repo.queryFromActionable('ts1', READ_VERSIONS[0], 'Query Thursday');

    const [patch] = chain.update.mock.calls[0] as [Record<string, unknown>];
    expect(patch).not.toHaveProperty('updated_at');
  });

  it('returns null when zero rows matched — the week changed under the query', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimesheetRepository();
    expect(
      await repo.queryFromActionable('ts1', READ_VERSIONS[0], 'Query Thursday')
    ).toBeNull();
  });

  it('raises a DatabaseError rather than looking like a lost race', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new TimesheetRepository();
    await expect(
      repo.queryFromActionable('ts1', READ_VERSIONS[0], 'Query Thursday')
    ).rejects.toThrow('Failed to query timesheet');
  });
});

/**
 * The parent's exit from `queried` (D-19, gap P2). Before this a queried week
 * had no parent-side exit at all — `approve` only moves a `submitted` row, so
 * a question asked in error froze the nanny's pay until she answered it.
 */
describe('TimesheetRepository.withdrawQueryFromQueried', () => {
  it('returns the week to submitted and clears the scratch note in one write', async () => {
    const chain = createMockQueryChain({
      data: { id: 'ts1', status: 'submitted' },
      error: null,
    });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new TimesheetRepository();
    await repo.withdrawQueryFromQueried('ts1', READ_VERSIONS[0]);

    expect(chain.update).toHaveBeenCalledWith({
      status: 'submitted',
      query_note: null,
    });
  });

  for (const version of READ_VERSIONS) {
    it(`constrains on the queried status AND the row version (${version})`, async () => {
      const chain = createMockQueryChain({ data: { id: 'ts1' }, error: null });
      mockSupabaseService.from.mockImplementation(() => chain);

      const repo = new TimesheetRepository();
      await repo.withdrawQueryFromQueried('ts1', version);

      expect(chain.eq).toHaveBeenCalledWith('id', 'ts1');
      expect(chain.eq).toHaveBeenCalledWith('status', 'queried');
      expect(chain.eq).toHaveBeenCalledWith('updated_at', version);
      expect(chain.eq).toHaveBeenCalledTimes(3);
    });
  }

  it('never touches approved_by/approved_at — a queried week was never approved', async () => {
    const chain = createMockQueryChain({ data: { id: 'ts1' }, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new TimesheetRepository();
    await repo.withdrawQueryFromQueried('ts1', READ_VERSIONS[0]);

    const [patch] = chain.update.mock.calls[0] as [Record<string, unknown>];
    expect(patch).not.toHaveProperty('approved_by');
    expect(patch).not.toHaveProperty('updated_at');
  });

  it('returns null when zero rows matched — the week changed under the withdraw', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );
    const repo = new TimesheetRepository();
    expect(
      await repo.withdrawQueryFromQueried('ts1', READ_VERSIONS[0])
    ).toBeNull();
  });

  it('raises a DatabaseError rather than looking like a lost race', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );
    const repo = new TimesheetRepository();
    await expect(
      repo.withdrawQueryFromQueried('ts1', READ_VERSIONS[0])
    ).rejects.toThrow('Failed to withdraw timesheet query');
  });
});

describe('TimesheetRepository.reopenFromApproved', () => {
  it('clears all four snapshot columns and the approval stamp in the SAME write', async () => {
    const chain = mockReopenChains(approvedRow, {
      data: { id: 'ts1', status: 'submitted' },
      error: null,
    });

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
      // 111: `reopen_reason` alone carries no figures, so the parent's own
      // undo keeps the same receipt the clock-out's demotion now keeps.
      previous_approval: {
        approved_at: FIXTURE_SNAPSHOT_AT,
        approved_by: 'parent-1',
        gross_minor: 14_800,
        currency: 'GBP',
        worked_minutes: 480,
      },
      gross_minor: null,
      currency: null,
      earnings: null,
      earnings_computed_at: null,
    });
  });

  // 111. The pre-read cannot go stale: the CAS below pins `updated_at` to the
  // version the SERVICE read, so a row that moved underneath writes nothing
  // at all rather than a receipt for the wrong figures.
  it('writes no receipt when the row is not actually approved', async () => {
    const chain = mockReopenChains(
      { ...approvedRow, status: 'submitted' },
      { data: { id: 'ts1' }, error: null }
    );

    await new TimesheetRepository().reopenFromApproved(
      'ts1',
      READ_VERSIONS[0],
      'missed break'
    );

    const [patch] = chain.update.mock.calls[0] as [Record<string, unknown>];
    expect(patch.previous_approval).toBeNull();
  });

  // `worked_minutes` comes out of the frozen `earnings` jsonb, and is NULL on
  // a snapshot that has no such key (`no_arrangement`, `currency_change`).
  // Never `total_minutes`: different basis, plausible, wrong on any week with
  // a paid cancellation.
  it('leaves worked_minutes null when the snapshot carries no such key', async () => {
    const chain = mockReopenChains(
      {
        ...approvedRow,
        earnings: { status: 'no_arrangement', unpriced_dates: [] },
      },
      { data: { id: 'ts1' }, error: null }
    );

    await new TimesheetRepository().reopenFromApproved(
      'ts1',
      READ_VERSIONS[0],
      'missed break'
    );

    const [patch] = chain.update.mock.calls[0] as [
      { previous_approval: Record<string, unknown> },
    ];
    expect(patch.previous_approval.worked_minutes).toBeNull();
    expect(patch.previous_approval.gross_minor).toBe(14_800);
  });

  // Best-effort, like the day-thread append the caller makes right after:
  // a receipt that cannot be read must not turn a parent's undo into a 500.
  it('still reopens when the pre-read fails, with no receipt', async () => {
    // A failed or missing pre-read collapses to a null row either way — no
    // receipt, and the reopen still lands.
    mockReopenChains(null, { data: { id: 'ts1' }, error: null });

    const result = await new TimesheetRepository().reopenFromApproved(
      'ts1',
      READ_VERSIONS[0],
      'missed break'
    );

    expect(result).toEqual({ id: 'ts1' });
  });

  it('leaves query_note alone — an undo-approve is not an open dispute', async () => {
    const chain = mockReopenChains(approvedRow, {
      data: { id: 'ts1' },
      error: null,
    });

    const repo = new TimesheetRepository();
    await repo.reopenFromApproved('ts1', READ_VERSIONS[0], 'missed break');

    const [patch] = chain.update.mock.calls[0] as [Record<string, unknown>];
    expect(patch).not.toHaveProperty('query_note');
  });

  for (const version of READ_VERSIONS) {
    it(`constrains the update on the approved status AND the row version (${version})`, async () => {
      const chain = mockReopenChains(approvedRow, {
        data: { id: 'ts1' },
        error: null,
      });

      const repo = new TimesheetRepository();
      await repo.reopenFromApproved('ts1', version, 'missed break');

      expect(chain.eq).toHaveBeenCalledWith('id', 'ts1');
      expect(chain.eq).toHaveBeenCalledWith('status', 'approved');
      expect(chain.eq).toHaveBeenCalledWith('updated_at', version);
      // Still exactly three: 111's receipt pre-read is a SEPARATE `from()`
      // with its own `.eq('id', ...)`, and it must never be miscounted as a
      // fourth predicate narrowing the guarded update.
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
    // First `from(...)` is 111's receipt pre-read; the failure under test is
    // the UPDATE, which must still surface as this domain's own error.
    mockReopenChains(approvedRow, { data: null, error: { message: 'boom' } });
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

const VIEWED_AT = '2026-08-16T12:00:00.000Z';

describe('TimesheetRepository.stampParentViewed — one-way', () => {
  it('stampParentViewed updates only while parent_viewed_at is null and returns null when already stamped', async () => {
    const stamped = { id: 'ts1', parent_viewed_at: VIEWED_AT };
    const chain = createMockQueryChain({ data: stamped, error: null });
    mockSupabaseService.from.mockImplementation(() => chain);

    const repo = new TimesheetRepository();
    expect(await repo.stampParentViewed('ts1', VIEWED_AT)).toEqual(stamped);
    expect(chain.update).toHaveBeenCalledWith({ parent_viewed_at: VIEWED_AT });
    expect(chain.eq).toHaveBeenCalledWith('id', 'ts1');
    expect(chain.is).toHaveBeenCalledWith('parent_viewed_at', null);
    expect(chain.maybeSingle).toHaveBeenCalled();

    const already = createMockQueryChain({ data: null, error: null });
    mockSupabaseService.from.mockImplementation(() => already);
    expect(await repo.stampParentViewed('ts1', VIEWED_AT)).toBeNull();
  });
});

/**
 * 102 — the clock-out's one write. What is testable here is the seam: the real
 * function name and the real two `p_*` parameter names, asserted verbatim
 * against what `102_paid_week_guards.sql` declares (D53) — a mock-shaped name
 * would pass this file and 500 in production. The function's own behaviour
 * (lock, then ask whether the week is paid, then one conditional update) lives
 * behind a row lock no unit test can reach: it is pinned against the SQL
 * source by `tests/unit/migration102PaidWeekGuards.test.ts` and executed for
 * real by `tests/integration/reopenWithPayments.integration.test.ts`.
 */
describe('TimesheetRepository.rollUpHours', () => {
  it('calls the REAL function name with the REAL two parameter names', async () => {
    mockSupabaseService.rpc.mockImplementation(() =>
      createMockQueryChain({
        data: { id: 'ts1', status: 'submitted' },
        error: null,
      })
    );

    await new TimesheetRepository().rollUpHours('ts1', 750);

    expect(mockSupabaseService.rpc).toHaveBeenCalledWith(
      'roll_up_timesheet_hours',
      { p_timesheet_id: 'ts1', p_total_minutes: 750 }
    );
  });

  it('sends NOTHING that decides the outcome — the locked function does', async () => {
    // No status, no snapshot, no "was it paid". A patch assembled here would
    // be a decision taken from a pre-read, which is the race 102 closes.
    mockSupabaseService.rpc.mockImplementation(() =>
      createMockQueryChain({ data: { id: 'ts1' }, error: null })
    );

    await new TimesheetRepository().rollUpHours('ts1', 450);

    const args = mockSupabaseService.rpc.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(Object.keys(args)).toEqual(['p_timesheet_id', 'p_total_minutes']);
  });

  it('returns the row the function answered with, so the caller reads the decision off it', async () => {
    const row = {
      id: 'ts1',
      status: 'approved',
      total_minutes: 750,
      hours_changed_after_payment_at: '2026-08-05T09:00:00.000Z',
    };
    mockSupabaseService.rpc.mockImplementation(() =>
      createMockQueryChain({ data: row, error: null })
    );

    expect(await new TimesheetRepository().rollUpHours('ts1', 750)).toEqual(
      row
    );
  });

  it('throws a DatabaseError when the RPC fails', async () => {
    mockSupabaseService.rpc.mockImplementation(() =>
      createMockQueryChain({ data: null, error: { message: 'boom' } })
    );

    await expect(
      new TimesheetRepository().rollUpHours('ts1', 750)
    ).rejects.toThrow('Failed to roll hours into timesheet');
  });

  it('throws rather than returning nothing when the row vanished mid-write', async () => {
    // A roll-up that matched no row is a real failure, not a race to absorb:
    // the caller has already found this timesheet.
    mockSupabaseService.rpc.mockImplementation(() =>
      createMockQueryChain({ data: null, error: null })
    );

    await expect(
      new TimesheetRepository().rollUpHours('ts1', 750)
    ).rejects.toThrow('Failed to roll hours into timesheet');
  });
});
