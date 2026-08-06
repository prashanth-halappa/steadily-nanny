import { describe, expect, it, mock } from 'bun:test';
import type { WeekEarnings } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import {
  TimeEntryNotFoundError,
  TimesheetNotFoundError,
} from '../../../../../src/domains/timesheet/errors/timesheetErrors';
import { TimesheetQueryService } from '../../../../../src/domains/timesheet/services/timesheetQueryService';
import type {
  TimeEntry,
  Timesheet,
} from '../../../../../src/domains/timesheet/types';

const runningEntry: TimeEntry = {
  id: 't1',
  household_id: 'h1',
  carer_id: 'carer-1',
  carer_display_name: 'Nia Rowe',
  shift_id: null,
  clock_in_at: '2026-08-03T08:00:00.000Z',
  clock_out_at: null,
  break_minutes: 0,
  scheduled_minutes: null,
  kind: 'worked',
  note: null,
  clock_in_location_ok: null,
  clock_out_location_ok: null,
  status: 'running',
  local_date: '2026-08-03',
  timezone: 'Europe/London',
  created_at: 't',
  updated_at: 't',
};

const timesheet: Timesheet = {
  id: 'ts1',
  household_id: 'h1',
  carer_id: 'carer-1',
  carer_display_name: 'Nia Rowe',
  week_start: '2026-08-03',
  total_minutes: 480,
  status: 'submitted',
  approved_by: null,
  approved_at: null,
  query_note: null,
  reopen_reason: null,
  created_at: 't',
  updated_at: 't',
};

const membership = {
  id: 'm1',
  household_id: 'h1',
  user_id: 'u1',
  role: 'parent',
};

const household = { id: 'h1', timezone: 'Europe/London' };

function makeTimeEntryRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findRunningForCarer: mock(async () => runningEntry),
    findById: mock(async () => runningEntry),
    listForHouseholdWeek: mock(async () => [runningEntry]),
    ...overrides,
  };
}

function makeTimesheetRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => timesheet),
    listForHousehold: mock(async () => [timesheet]),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveMembership: mock(async () => membership),
    ...overrides,
  };
}

function makeHouseholdRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => household),
    ...overrides,
  };
}

describe('TimesheetQueryService.getRunning', () => {
  it("returns the caller's running entry", async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    expect(await svc.getRunning('carer-1')).toEqual(runningEntry);
  });

  it('returns null when nothing is running', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo({ findRunningForCarer: mock(async () => null) }),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    expect(await svc.getRunning('carer-1')).toBeNull();
  });
});

describe('TimesheetQueryService.getOwnedTimeEntry', () => {
  it('returns the entry when it belongs to the caller', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    expect(await svc.getOwnedTimeEntry('carer-1', 't1')).toEqual(runningEntry);
  });

  it("throws TimeEntryNotFoundError for someone else's entry (no existence leak)", async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    await expect(
      svc.getOwnedTimeEntry('someone-else', 't1')
    ).rejects.toBeInstanceOf(TimeEntryNotFoundError);
  });

  it('throws the SAME error for a truly missing entry', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo({ findById: mock(async () => null) }),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    await expect(
      svc.getOwnedTimeEntry('carer-1', 'missing')
    ).rejects.toBeInstanceOf(TimeEntryNotFoundError);
  });
});

describe('TimesheetQueryService.listForHouseholdWeek', () => {
  it('uses the given week_start when provided', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const svc = new TimesheetQueryService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    await svc.listForHouseholdWeek('u1', 'h1', '2026-08-03');
    // Fourth arg is the optional carer filter — undefined here means "every
    // carer", the household-wide view this endpoint has always served.
    expect(timeEntryRepo.listForHouseholdWeek).toHaveBeenCalledWith(
      'h1',
      '2026-08-03',
      '2026-08-10',
      undefined
    );
  });

  it('throws for a non-member', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) }),
      makeHouseholdRepo()
    );
    await expect(
      svc.listForHouseholdWeek('u2', 'h1', '2026-08-03')
    ).rejects.toThrow();
  });
});

describe('TimesheetQueryService.getOwnedTimesheet', () => {
  it('returns the timesheet for an active household member', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    expect(await svc.getOwnedTimesheet('u1', 'ts1')).toEqual(timesheet);
  });

  it('throws TimesheetNotFoundError for a non-member (no existence leak)', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) }),
      makeHouseholdRepo()
    );
    await expect(svc.getOwnedTimesheet('u2', 'ts1')).rejects.toBeInstanceOf(
      TimesheetNotFoundError
    );
  });
});

describe('TimesheetQueryService.listTimesheetsForHousehold', () => {
  it('lists once membership is confirmed', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );
    expect(await svc.listTimesheetsForHousehold('u1', 'h1')).toEqual([
      timesheet,
    ]);
  });
});

// =============================================================================
// The week read — LIVE vs FROZEN (TIER0-PLAN.md Phase 2 "Wiring",
// docs/11-MONEY.md §3). This is the decision the client must never make.
// =============================================================================

const ARRANGEMENT_ID = '11111111-1111-4111-8111-111111111101';

const okEarnings: WeekEarnings = {
  status: 'ok',
  week_start: '2026-08-03',
  currency: 'GBP',
  lines: [
    {
      kind: 'regular',
      minutes: 480,
      rate_minor: 1850,
      multiplier: null,
      amount_minor: 14_800,
      from_date: '2026-08-03',
      to_date: '2026-08-03',
      arrangement_id: ARRANGEMENT_ID,
    },
  ],
  gross_minor: 14_800,
  reimbursements_minor: 0,
  worked_minutes: 480,
  payable_minutes: 480,
  guaranteed_minutes_per_week: null,
};

/** What a live compute would say AFTER a post-approval raise — deliberately different. */
const raisedEarnings: WeekEarnings = {
  ...okEarnings,
  status: 'ok',
  currency: 'GBP',
  lines: [
    {
      kind: 'regular',
      minutes: 480,
      rate_minor: 2500,
      multiplier: null,
      amount_minor: 20_000,
      from_date: '2026-08-03',
      to_date: '2026-08-03',
      arrangement_id: ARRANGEMENT_ID,
    },
  ],
  gross_minor: 20_000,
  reimbursements_minor: 0,
  worked_minutes: 480,
  payable_minutes: 480,
  guaranteed_minutes_per_week: null,
};

const approvedTimesheet = {
  ...timesheet,
  status: 'approved',
  approved_by: 'parent-1',
  approved_at: '2026-08-10T09:00:00.000Z',
  gross_minor: 14_800,
  currency: 'GBP',
  earnings: okEarnings,
  earnings_computed_at: '2026-08-10T09:00:00.000Z',
};

function makeEarnings(overrides: Record<string, unknown> = {}): any {
  return {
    computeForWeek: mock(async () => okEarnings),
    ...overrides,
  };
}

describe('TimesheetQueryService.getWeekWithEarnings — live weeks', () => {
  for (const status of ['open', 'submitted', 'queried'] as const) {
    it(`computes earnings live for a ${status} week, scoped to its household/carer/week`, async () => {
      const earnings = makeEarnings();
      const svc = new TimesheetQueryService(
        makeTimeEntryRepo(),
        makeTimesheetRepo({
          findById: mock(async () => ({ ...timesheet, status })),
        }),
        makeMemberRepo(),
        makeHouseholdRepo(),
        earnings
      );

      const week = await svc.getWeekWithEarnings('u1', 'ts1');

      expect(earnings.computeForWeek).toHaveBeenCalledWith(
        'h1',
        'carer-1',
        '2026-08-03'
      );
      expect(week.earnings).toEqual(okEarnings);
      expect(week.status).toBe(status);
    });
  }

  it('writes NOTHING while reading a live week — no snapshot columns, ever', async () => {
    const timesheetRepo = makeTimesheetRepo({
      update: mock(async () => timesheet),
      create: mock(async () => timesheet),
    });
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeEarnings()
    );

    await svc.getWeekWithEarnings('u1', 'ts1');

    expect(timesheetRepo.update).not.toHaveBeenCalled();
    expect(timesheetRepo.create).not.toHaveBeenCalled();
  });

  it('passes the no_arrangement arm straight through to the week response', async () => {
    const noArrangement: WeekEarnings = {
      status: 'no_arrangement',
      week_start: '2026-08-03',
      unpriced_dates: ['2026-08-03'],
    };
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeEarnings({ computeForWeek: mock(async () => noArrangement) })
    );

    const week = await svc.getWeekWithEarnings('u1', 'ts1');

    expect(week.earnings).toEqual(noArrangement);
  });

  it('renders hours-only for a departed carer — there is no carer to price against', async () => {
    const earnings = makeEarnings();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({
        findById: mock(async () => ({ ...timesheet, carer_id: null })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      earnings
    );

    const week = await svc.getWeekWithEarnings('u1', 'ts1');

    expect(week.earnings).toEqual({
      status: 'hours_only',
      week_start: '2026-08-03',
      reason: 'carer_removed',
    });
    expect(earnings.computeForWeek).not.toHaveBeenCalled();
  });

  it('enforces membership before pricing anything', async () => {
    const earnings = makeEarnings();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) }),
      makeHouseholdRepo(),
      earnings
    );

    await expect(svc.getWeekWithEarnings('u2', 'ts1')).rejects.toBeInstanceOf(
      TimesheetNotFoundError
    );
    expect(earnings.computeForWeek).not.toHaveBeenCalled();
  });
});

describe('TimesheetQueryService.getWeekWithEarnings — approved weeks are FROZEN', () => {
  it('returns the snapshot and never recomputes', async () => {
    const earnings = makeEarnings();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({ findById: mock(async () => approvedTimesheet) }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      earnings
    );

    const week = await svc.getWeekWithEarnings('u1', 'ts1');

    expect(week.earnings).toEqual(okEarnings);
    expect(earnings.computeForWeek).not.toHaveBeenCalled();
  });

  it('keeps the frozen figure after the arrangement changes — a raise never rewrites a signed week', async () => {
    // The live engine now says £200.00; the approved week must still say
    // £148.00 (docs/11-MONEY.md §3).
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({ findById: mock(async () => approvedTimesheet) }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeEarnings({ computeForWeek: mock(async () => raisedEarnings) })
    );

    const week = await svc.getWeekWithEarnings('u1', 'ts1');

    expect(week.earnings.status === 'ok' && week.earnings.gross_minor).toBe(
      14_800
    );
  });

  it('round-trips the stored jsonb through WeekEarningsSchema rather than trusting it', async () => {
    // Stored with an extra column the schema does not know about; the parsed
    // result must be the schema's shape, not the raw row.
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({
        findById: mock(async () => ({
          ...approvedTimesheet,
          earnings: { ...okEarnings, legacy_field: 'ignored' },
        })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeEarnings()
    );

    const week = await svc.getWeekWithEarnings('u1', 'ts1');

    expect(week.earnings).toEqual(okEarnings);
  });

  it('carries a frozen no_arrangement snapshot through unchanged', async () => {
    const frozenNoArrangement: WeekEarnings = {
      status: 'no_arrangement',
      week_start: '2026-08-03',
      unpriced_dates: ['2026-08-03'],
    };
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({
        findById: mock(async () => ({
          ...approvedTimesheet,
          gross_minor: null,
          currency: null,
          earnings: frozenNoArrangement,
        })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeEarnings()
    );

    expect((await svc.getWeekWithEarnings('u1', 'ts1')).earnings).toEqual(
      frozenNoArrangement
    );
  });
});

describe('TimesheetQueryService.getWeekWithEarnings — the legacy arm', () => {
  it('renders hours-only for a week approved before migration 042 (NULL snapshot)', async () => {
    const earnings = makeEarnings();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({
        findById: mock(async () => ({
          ...approvedTimesheet,
          gross_minor: null,
          currency: null,
          earnings: null,
          earnings_computed_at: null,
        })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      earnings
    );

    const week = await svc.getWeekWithEarnings('u1', 'ts1');

    expect(week.earnings).toEqual({
      status: 'hours_only',
      week_start: '2026-08-03',
      reason: 'legacy_approval',
    });
  });

  it('NEVER live-computes a legacy approved week — no live number under an Approved label', async () => {
    const earnings = makeEarnings();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({
        findById: mock(async () => ({
          ...approvedTimesheet,
          earnings: null,
        })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      earnings
    );

    await svc.getWeekWithEarnings('u1', 'ts1');

    expect(earnings.computeForWeek).not.toHaveBeenCalled();
  });

  it('degrades a CORRUPT snapshot to hours-only rather than crashing the screen', async () => {
    const earnings = makeEarnings();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({
        findById: mock(async () => ({
          ...approvedTimesheet,
          earnings: { status: 'ok', gross_minor: 'lots' },
        })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      earnings
    );

    const week = await svc.getWeekWithEarnings('u1', 'ts1');

    expect(week.earnings).toEqual({
      status: 'hours_only',
      week_start: '2026-08-03',
      reason: 'unreadable_snapshot',
    });
    expect(earnings.computeForWeek).not.toHaveBeenCalled();
  });

  it('treats a non-object snapshot (string, number) as unreadable too', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({
        findById: mock(async () => ({ ...approvedTimesheet, earnings: 'ok' })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeEarnings()
    );

    expect((await svc.getWeekWithEarnings('u1', 'ts1')).earnings).toMatchObject(
      { status: 'hours_only', reason: 'unreadable_snapshot' }
    );
  });
});

describe('TimesheetQueryService — the raw snapshot columns never reach the wire', () => {
  it('strips them from the list, exactly as the week read does', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({
        listForHousehold: mock(async () => [approvedTimesheet]),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeEarnings()
    );

    const [row] = await svc.listTimesheetsForHousehold('u1', 'h1');

    for (const column of [
      'gross_minor',
      'currency',
      'earnings',
      'earnings_computed_at',
    ]) {
      expect(row && column in row).toBe(false);
    }
    // ...while every real timesheet field survives.
    expect(row?.total_minutes).toBe(480);
    expect(row?.status).toBe('approved');
  });

  it('strips them from the week read too', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({ findById: mock(async () => approvedTimesheet) }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeEarnings()
    );

    const week = await svc.getWeekWithEarnings('u1', 'ts1');

    expect('gross_minor' in week).toBe(false);
    expect('earnings_computed_at' in week).toBe(false);
  });
});

// =============================================================================
// F-B1-3 (API half) — nothing was scoped by carer, so a two-carer household
// summed every carer's hours into whichever timesheet came back first.
// F-B3b-3 (timesheet half) — a removed nanny kept write access, because the
// entry gate checked ownership and never membership.
// =============================================================================

describe('TimesheetQueryService.listForHouseholdWeek — carer scoping (F-B1-3)', () => {
  it('passes the carer filter through to the entry query', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const svc = new TimesheetQueryService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );

    await svc.listForHouseholdWeek('u1', 'h1', '2026-08-03', 'carer-1');

    expect(timeEntryRepo.listForHouseholdWeek).toHaveBeenCalledWith(
      'h1',
      '2026-08-03',
      '2026-08-10',
      'carer-1'
    );
  });
});

describe('TimesheetQueryService.listTimesheetsForHousehold — carer scoping (F-B1-3)', () => {
  it('passes the carer filter through to the timesheet query', async () => {
    const timesheetRepo = makeTimesheetRepo();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeMemberRepo(),
      makeHouseholdRepo()
    );

    await svc.listTimesheetsForHousehold('u1', 'h1', 'carer-1');

    expect(timesheetRepo.listForHousehold).toHaveBeenCalledWith(
      'h1',
      'carer-1'
    );
  });
});

describe('TimesheetQueryService.getOwnedTimeEntry — membership, not just ownership (F-B3b-3)', () => {
  it('throws TimeEntryNotFoundError once the carer membership is no longer active', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo({ findActiveMembership: mock(async () => null) }),
      makeHouseholdRepo()
    );

    await expect(svc.getOwnedTimeEntry('carer-1', 't1')).rejects.toBeInstanceOf(
      TimeEntryNotFoundError
    );
  });

  it('checks membership against the ENTRY household, not one the caller supplied', async () => {
    const memberRepo = makeMemberRepo();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      memberRepo,
      makeHouseholdRepo()
    );

    await svc.getOwnedTimeEntry('carer-1', 't1');

    expect(memberRepo.findActiveMembership).toHaveBeenCalledWith(
      'h1',
      'carer-1'
    );
  });
});
