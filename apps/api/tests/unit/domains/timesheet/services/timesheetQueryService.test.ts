import { describe, expect, it, mock } from 'bun:test';
import type { WeekEarnings } from '@steadily-nanny/shared-types/schemas/timesheet.schema';

// The house logger, stubbed so the degraded-snapshot path's `logger.error`
// is assertable. Registered before the service is imported below.
const mockLogger = {
  info: mock(() => undefined),
  warn: mock(() => undefined),
  error: mock(() => undefined),
  debug: mock(() => undefined),
};
mock.module('../../../../../src/middlewares/logger', () => ({
  logger: mockLogger,
}));

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
  status: 'active',
};

// `week_starts_on` spelled out so the current-week read exercises the real
// household value rather than the no-household fallback. 1 = Monday.
const household = { id: 'h1', timezone: 'Europe/London', week_starts_on: 1 };

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
    findMembershipAnyStatus: mock(async () => membership),
    ...overrides,
  };
}

/** Neither lookup finds anything — a stranger to this household. */
function makeNonMemberRepo(): any {
  return makeMemberRepo({
    findActiveMembership: mock(async () => null),
    findMembershipAnyStatus: mock(async () => null),
  });
}

/**
 * A `removed` member: invisible to the active-only lookup, returned by the
 * any-status one — exactly what the real repository does. Every read gate
 * that still calls `findActiveMembership` therefore refuses her, and every
 * one that has moved to `findMembershipAnyStatus` sees her role.
 */
function makeRemovedMemberRepo(role: string, userId: string): any {
  return makeMemberRepo({
    findActiveMembership: mock(async () => null),
    findMembershipAnyStatus: mock(async () => ({
      ...membership,
      id: `m-${userId}`,
      user_id: userId,
      role,
      status: 'removed',
    })),
  });
}

function makeHouseholdRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => household),
    ...overrides,
  };
}

// §11.1.1's fast-path computer — DI'd as the 8th constructor arg (payments
// and events default fine since neither `getWeekWithEarnings` call path
// touches them, but a NothingUnusualService default would make a real
// network call, so every test that calls `getWeekWithEarnings` supplies this
// fake explicitly).
function makeNothingUnusualComputer(
  overrides: Record<string, unknown> = {}
): any {
  return {
    computeForWeek: mock(async () => false),
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
      makeNonMemberRepo(),
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
      makeNonMemberRepo(),
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
        earnings,
        undefined,
        undefined,
        makeNothingUnusualComputer()
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
      makeEarnings(),
      undefined,
      undefined,
      makeNothingUnusualComputer()
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
      makeEarnings({ computeForWeek: mock(async () => noArrangement) }),
      undefined,
      undefined,
      makeNothingUnusualComputer()
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
      earnings,
      undefined,
      undefined,
      makeNothingUnusualComputer()
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
      makeNonMemberRepo(),
      makeHouseholdRepo(),
      earnings,
      undefined,
      undefined,
      makeNothingUnusualComputer()
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
      earnings,
      undefined,
      undefined,
      makeNothingUnusualComputer()
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
      makeEarnings({ computeForWeek: mock(async () => raisedEarnings) }),
      undefined,
      undefined,
      makeNothingUnusualComputer()
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
      makeEarnings(),
      undefined,
      undefined,
      makeNothingUnusualComputer()
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
      makeEarnings(),
      undefined,
      undefined,
      makeNothingUnusualComputer()
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
      earnings,
      undefined,
      undefined,
      makeNothingUnusualComputer()
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
      earnings,
      undefined,
      undefined,
      makeNothingUnusualComputer()
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
      earnings,
      undefined,
      undefined,
      makeNothingUnusualComputer()
    );

    const week = await svc.getWeekWithEarnings('u1', 'ts1');

    expect(week.earnings).toEqual({
      status: 'hours_only',
      week_start: '2026-08-03',
      reason: 'unreadable_snapshot',
    });
    expect(earnings.computeForWeek).not.toHaveBeenCalled();
  });

  it('LOGS the corrupt snapshot — a silently degraded week is one nobody fixes', async () => {
    // hours-only is the right thing to render, but it is also indistinguishable
    // from a legacy approval on screen. Without a log, a snapshot that stopped
    // parsing (a schema change, a bad write) degrades every affected week
    // quietly and forever. `logger.error` reaches Sentry via the transport.
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
      makeEarnings(),
      undefined,
      undefined,
      makeNothingUnusualComputer()
    );

    await svc.getWeekWithEarnings('u1', 'ts1');

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timesheetId: 'ts1' })
    );
  });

  it('reads a snapshot carrying a line kind THIS BUILD HAS NEVER HEARD OF, intact', async () => {
    // The fleet rule from the client side, applied on the server: a seventh
    // kind must not turn a real approved week into hours-only. The line is
    // carried through verbatim — the reader does not have to understand a
    // kind to hand it on.
    mockLogger.error.mockClear();
    const withUnknownKind = {
      ...okEarnings,
      lines: [
        {
          kind: 'night_differential',
          minutes: 120,
          rate_minor: 2000,
          multiplier: null,
          amount_minor: 4000,
          from_date: '2026-08-03',
          to_date: '2026-08-03',
          arrangement_id: ARRANGEMENT_ID,
        },
      ],
    };
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({
        findById: mock(async () => ({
          ...approvedTimesheet,
          earnings: withUnknownKind,
        })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeEarnings(),
      undefined,
      undefined,
      makeNothingUnusualComputer()
    );

    const week = await svc.getWeekWithEarnings('u1', 'ts1');

    expect(week.earnings.status).toBe('ok');
    expect(week.earnings).toEqual(withUnknownKind);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('degrades a v: 2 snapshot to hours-only and LOGS it — an unknown format is refused, never guessed at', async () => {
    mockLogger.error.mockClear();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({
        findById: mock(async () => ({
          ...approvedTimesheet,
          earnings: { ...okEarnings, v: 2 },
        })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeEarnings(),
      undefined,
      undefined,
      makeNothingUnusualComputer()
    );

    const week = await svc.getWeekWithEarnings('u1', 'ts1');

    expect(week.earnings).toEqual({
      status: 'hours_only',
      week_start: '2026-08-03',
      reason: 'unreadable_snapshot',
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timesheetId: 'ts1' })
    );
  });

  it('reads back a v: 1 snapshot exactly as the approve path wrote it', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({
        findById: mock(async () => ({
          ...approvedTimesheet,
          earnings: { ...okEarnings, v: 1 },
        })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeEarnings(),
      undefined,
      undefined,
      makeNothingUnusualComputer()
    );

    expect((await svc.getWeekWithEarnings('u1', 'ts1')).earnings).toEqual({
      ...okEarnings,
      v: 1,
    });
  });

  it('treats a non-object snapshot (string, number) as unreadable too', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({
        findById: mock(async () => ({ ...approvedTimesheet, earnings: 'ok' })),
      }),
      makeMemberRepo(),
      makeHouseholdRepo(),
      makeEarnings(),
      undefined,
      undefined,
      makeNothingUnusualComputer()
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
      makeEarnings(),
      undefined,
      undefined,
      makeNothingUnusualComputer()
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
      makeRemovedMemberRepo('nanny', 'carer-1'),
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

// =============================================================================
// PAYROLL AUDIT TRAIL — a `removed` member keeps READ access to hours and pay,
// role-scoped: a removed parent/owner keeps the household-wide view, a removed
// nanny is pinned to her OWN carer scope, a removed helper gets nothing. Every
// WRITE gate (getOwnedTimesheet / loadOwnedRow / getOwnedTimeEntry, and the
// command service behind them) stays ACTIVE-ONLY — F-B3b-3 must stay closed.
// =============================================================================

describe('TimesheetQueryService.listForHouseholdWeek — removed members', () => {
  it('a removed parent keeps the household-wide entry list', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const svc = new TimesheetQueryService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeRemovedMemberRepo('parent', 'parent-1'),
      makeHouseholdRepo()
    );

    await svc.listForHouseholdWeek('parent-1', 'h1', '2026-08-03');

    expect(timeEntryRepo.listForHouseholdWeek).toHaveBeenCalledWith(
      'h1',
      '2026-08-03',
      '2026-08-10',
      undefined
    );
  });

  it('a removed nanny is FORCED to her own carer scope', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const svc = new TimesheetQueryService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeRemovedMemberRepo('nanny', 'carer-1'),
      makeHouseholdRepo()
    );

    await svc.listForHouseholdWeek('carer-1', 'h1', '2026-08-03');

    expect(timeEntryRepo.listForHouseholdWeek).toHaveBeenCalledWith(
      'h1',
      '2026-08-03',
      '2026-08-10',
      'carer-1'
    );
  });

  it("a removed nanny's client-passed carer_id is IGNORED, never honoured", async () => {
    // The filter is a client input. Without the override a removed nanny reads
    // carer-2's hours by asking for them.
    const timeEntryRepo = makeTimeEntryRepo();
    const svc = new TimesheetQueryService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeRemovedMemberRepo('nanny', 'carer-1'),
      makeHouseholdRepo()
    );

    await svc.listForHouseholdWeek('carer-1', 'h1', '2026-08-03', 'carer-2');

    expect(timeEntryRepo.listForHouseholdWeek).toHaveBeenCalledWith(
      'h1',
      '2026-08-03',
      '2026-08-10',
      'carer-1'
    );
  });

  it('a removed HELPER is denied — no payroll surface, active or not', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeRemovedMemberRepo('helper', 'helper-1'),
      makeHouseholdRepo()
    );

    await expect(
      svc.listForHouseholdWeek('helper-1', 'h1', '2026-08-03')
    ).rejects.toBeInstanceOf(TimesheetNotFoundError);
  });

  // D-21 / P8. The gate used to short-circuit on `status === 'active'` BEFORE
  // it looked at the role, so an ACTIVE nanny read the whole household's
  // entries — every other carer's exact clock-in times, break lengths and
  // shift notes — and an ACTIVE helper read them too. Role decides the scope
  // now; status decides nothing at all.
  it('an ACTIVE nanny is FORCED to her own carer scope — role narrows, not status', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const svc = new TimesheetQueryService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo({
        findMembershipAnyStatus: mock(async () => ({
          ...membership,
          role: 'nanny',
        })),
      }),
      makeHouseholdRepo()
    );

    await svc.listForHouseholdWeek('carer-1', 'h1', '2026-08-03');

    expect(timeEntryRepo.listForHouseholdWeek).toHaveBeenCalledWith(
      'h1',
      '2026-08-03',
      '2026-08-10',
      'carer-1'
    );
  });

  it("an ACTIVE nanny's client-passed carer_id is IGNORED — P8, the whole gap", async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const svc = new TimesheetQueryService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo({
        findMembershipAnyStatus: mock(async () => ({
          ...membership,
          role: 'nanny',
        })),
      }),
      makeHouseholdRepo()
    );

    await svc.listForHouseholdWeek('carer-1', 'h1', '2026-08-03', 'carer-2');

    expect(timeEntryRepo.listForHouseholdWeek).toHaveBeenCalledWith(
      'h1',
      '2026-08-03',
      '2026-08-10',
      'carer-1'
    );
  });

  it('an ACTIVE HELPER is denied outright — she never had a payroll surface', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo({
        findMembershipAnyStatus: mock(async () => ({
          ...membership,
          role: 'helper',
        })),
      }),
      makeHouseholdRepo()
    );

    await expect(
      svc.listForHouseholdWeek('helper-1', 'h1', '2026-08-03')
    ).rejects.toBeInstanceOf(TimesheetNotFoundError);
  });

  it('an ACTIVE owner still reads every carer — parents lose nothing', async () => {
    const timeEntryRepo = makeTimeEntryRepo();
    const svc = new TimesheetQueryService(
      timeEntryRepo,
      makeTimesheetRepo(),
      makeMemberRepo({
        findMembershipAnyStatus: mock(async () => ({
          ...membership,
          role: 'owner',
        })),
      }),
      makeHouseholdRepo()
    );

    await svc.listForHouseholdWeek('owner-1', 'h1', '2026-08-03');

    expect(timeEntryRepo.listForHouseholdWeek).toHaveBeenCalledWith(
      'h1',
      '2026-08-03',
      '2026-08-10',
      undefined
    );
  });
});

describe('TimesheetQueryService.listTimesheetsForHousehold — removed members', () => {
  it('a removed parent keeps the household-wide timesheet list', async () => {
    const timesheetRepo = makeTimesheetRepo();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeRemovedMemberRepo('parent', 'parent-1'),
      makeHouseholdRepo()
    );

    await svc.listTimesheetsForHousehold('parent-1', 'h1');

    expect(timesheetRepo.listForHousehold).toHaveBeenCalledWith(
      'h1',
      undefined
    );
  });

  it("a removed nanny's list is forced to her own rows, client filter ignored", async () => {
    const timesheetRepo = makeTimesheetRepo();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      timesheetRepo,
      makeRemovedMemberRepo('nanny', 'carer-1'),
      makeHouseholdRepo()
    );

    await svc.listTimesheetsForHousehold('carer-1', 'h1', 'carer-2');

    expect(timesheetRepo.listForHousehold).toHaveBeenCalledWith(
      'h1',
      'carer-1'
    );
  });

  it('a removed helper is denied', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeRemovedMemberRepo('helper', 'helper-1'),
      makeHouseholdRepo()
    );

    await expect(
      svc.listTimesheetsForHousehold('helper-1', 'h1')
    ).rejects.toBeInstanceOf(TimesheetNotFoundError);
  });
});

describe('TimesheetQueryService.getReadableTimesheet — the READ-ONLY by-id gate', () => {
  it('a removed nanny reads her OWN week', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeRemovedMemberRepo('nanny', 'carer-1'),
      makeHouseholdRepo()
    );

    expect(await svc.getReadableTimesheet('carer-1', 'ts1')).toMatchObject({
      id: 'ts1',
      carer_id: 'carer-1',
    });
  });

  it("a removed nanny is refused ANOTHER carer's week", async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({
        findById: mock(async () => ({ ...timesheet, carer_id: 'carer-2' })),
      }),
      makeRemovedMemberRepo('nanny', 'carer-1'),
      makeHouseholdRepo()
    );

    await expect(
      svc.getReadableTimesheet('carer-1', 'ts1')
    ).rejects.toBeInstanceOf(TimesheetNotFoundError);
  });

  it('a removed parent reads any carer’s week — they paid the money', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({
        findById: mock(async () => ({ ...timesheet, carer_id: 'carer-2' })),
      }),
      makeRemovedMemberRepo('parent', 'parent-1'),
      makeHouseholdRepo()
    );

    expect(await svc.getReadableTimesheet('parent-1', 'ts1')).toMatchObject({
      id: 'ts1',
    });
  });

  it('a removed helper is refused', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeRemovedMemberRepo('helper', 'helper-1'),
      makeHouseholdRepo()
    );

    await expect(
      svc.getReadableTimesheet('helper-1', 'ts1')
    ).rejects.toBeInstanceOf(TimesheetNotFoundError);
  });

  it('a non-member is refused with the SAME error as a missing row', async () => {
    // Byte-for-byte identical, not merely the same class: `toClientJSON`
    // serialises `metadata` for any sub-500 status, so a denial carrying
    // `reason: 'household_not_accessible'` while a missing row carries
    // `reason: 'TIMESHEET_NOT_FOUND'` is an existence oracle — a stranger
    // learns which timesheet ids are real by reading the 404 body.
    const existing = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeNonMemberRepo(),
      makeHouseholdRepo()
    );
    const missing = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({ findById: mock(async () => null) }),
      makeNonMemberRepo(),
      makeHouseholdRepo()
    );

    const notYours = (await existing
      .getReadableTimesheet('stranger', 'ts1')
      .catch((error: unknown) => error)) as TimesheetNotFoundError;
    const noSuchRow = (await missing
      .getReadableTimesheet('stranger', 'ts1')
      .catch((error: unknown) => error)) as TimesheetNotFoundError;

    expect(notYours).toBeInstanceOf(TimesheetNotFoundError);
    expect(noSuchRow).toBeInstanceOf(TimesheetNotFoundError);
    expect(notYours.toClientJSON()).toEqual(noSuchRow.toClientJSON());
  });

  it('a missing timesheet throws before any membership lookup happens', async () => {
    const memberRepo = makeMemberRepo();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({ findById: mock(async () => null) }),
      memberRepo,
      makeHouseholdRepo()
    );

    await expect(
      svc.getReadableTimesheet('u1', 'missing')
    ).rejects.toBeInstanceOf(TimesheetNotFoundError);
    expect(memberRepo.findMembershipAnyStatus).not.toHaveBeenCalled();
  });

  it('an active member reads it exactly as before', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeMemberRepo(),
      makeHouseholdRepo()
    );

    expect(await svc.getReadableTimesheet('u1', 'ts1')).toMatchObject(
      timesheet
    );
  });
});

describe('TimesheetQueryService.getWeekWithEarnings — removed members', () => {
  it("a removed nanny's own week still serves EARNINGS, not the hours-only fallback", async () => {
    // `carer_removed` keys on a NULL carer_id (account deletion, migration
    // 033). A status removal keeps the carer_id, so her week prices normally.
    const earnings = makeEarnings();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeRemovedMemberRepo('nanny', 'carer-1'),
      makeHouseholdRepo(),
      earnings,
      undefined,
      undefined,
      makeNothingUnusualComputer()
    );

    const week = await svc.getWeekWithEarnings('carer-1', 'ts1');

    expect(week.earnings).toEqual(okEarnings);
    expect(earnings.computeForWeek).toHaveBeenCalledWith(
      'h1',
      'carer-1',
      '2026-08-03'
    );
  });

  it('an APPROVED week reads its frozen snapshot for a removed nanny too', async () => {
    const earnings = makeEarnings();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({ findById: mock(async () => approvedTimesheet) }),
      makeRemovedMemberRepo('nanny', 'carer-1'),
      makeHouseholdRepo(),
      earnings,
      undefined,
      undefined,
      makeNothingUnusualComputer()
    );

    const week = await svc.getWeekWithEarnings('carer-1', 'ts1');

    expect(week.earnings).toEqual(okEarnings);
    expect(earnings.computeForWeek).not.toHaveBeenCalled();
  });

  it("a removed nanny cannot price another carer's week", async () => {
    const earnings = makeEarnings();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo({
        findById: mock(async () => ({ ...timesheet, carer_id: 'carer-2' })),
      }),
      makeRemovedMemberRepo('nanny', 'carer-1'),
      makeHouseholdRepo(),
      earnings,
      undefined,
      undefined,
      makeNothingUnusualComputer()
    );

    await expect(
      svc.getWeekWithEarnings('carer-1', 'ts1')
    ).rejects.toBeInstanceOf(TimesheetNotFoundError);
    expect(earnings.computeForWeek).not.toHaveBeenCalled();
  });
});

describe('TimesheetQueryService — the WRITE gates stay ACTIVE-ONLY (F-B3b-3)', () => {
  it('getOwnedTimesheet refuses a removed PARENT — the approve/query/reopen lookup', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeRemovedMemberRepo('parent', 'parent-1'),
      makeHouseholdRepo()
    );

    await expect(
      svc.getOwnedTimesheet('parent-1', 'ts1')
    ).rejects.toBeInstanceOf(TimesheetNotFoundError);
  });

  it('getOwnedTimesheet refuses a removed NANNY reading her own week — reads use getReadableTimesheet', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeRemovedMemberRepo('nanny', 'carer-1'),
      makeHouseholdRepo()
    );

    await expect(
      svc.getOwnedTimesheet('carer-1', 'ts1')
    ).rejects.toBeInstanceOf(TimesheetNotFoundError);
  });

  it('getOwnedTimeEntry refuses a removed nanny — clock-out and corrections stay shut', async () => {
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      makeRemovedMemberRepo('nanny', 'carer-1'),
      makeHouseholdRepo()
    );

    await expect(svc.getOwnedTimeEntry('carer-1', 't1')).rejects.toBeInstanceOf(
      TimeEntryNotFoundError
    );
  });

  it('both write gates use the ACTIVE-only lookup, never the any-status one', async () => {
    const memberRepo = makeMemberRepo();
    const svc = new TimesheetQueryService(
      makeTimeEntryRepo(),
      makeTimesheetRepo(),
      memberRepo,
      makeHouseholdRepo()
    );

    await svc.getOwnedTimesheet('u1', 'ts1');
    await svc.getOwnedTimeEntry('carer-1', 't1');

    expect(memberRepo.findActiveMembership).toHaveBeenCalledTimes(2);
    expect(memberRepo.findMembershipAnyStatus).not.toHaveBeenCalled();
  });
});
