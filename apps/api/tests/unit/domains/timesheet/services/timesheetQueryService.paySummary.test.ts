/**
 * @module tests/unit/domains/timesheet/services/timesheetQueryService.paySummary
 *
 * `exportCarerPaySummaryCsv` (nanny pay record) + `exportYearEndSummaryCsv`
 * (parent payroll handoff) — D-29's export pack, P11/P12. Both are strictly
 * additive over frozen approved weeks: no live estimate ever appears, and a
 * mixed-currency range refuses rather than blends.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

let TimesheetQueryService: typeof import('../../../../../src/domains/timesheet/services/timesheetQueryService').TimesheetQueryService;
let PaySummaryExportError: typeof import('../../../../../src/domains/timesheet/errors/timesheetErrors').PaySummaryExportError;

const mockLogger = {
  info: mock(() => undefined),
  warn: mock(() => undefined),
  error: mock(() => undefined),
  debug: mock(() => undefined),
};

beforeAll(async () => {
  mock.module('../../../../../src/middlewares/logger', () => ({
    logger: mockLogger,
  }));
  TimesheetQueryService = (
    await import(
      '../../../../../src/domains/timesheet/services/timesheetQueryService'
    )
  ).TimesheetQueryService;
  PaySummaryExportError = (
    await import('../../../../../src/domains/timesheet/errors/timesheetErrors')
  ).PaySummaryExportError;
});

const okSnapshot = (grossMinor: number, reimbursementsMinor = 0) => ({
  status: 'ok',
  week_start: '2026-08-03',
  currency: 'USD',
  lines: [],
  gross_minor: grossMinor,
  reimbursements_minor: reimbursementsMinor,
  worked_minutes: 0,
  payable_minutes: 0,
  guaranteed_minutes_per_week: null,
});

function tsRow(over: Record<string, unknown> = {}): any {
  return {
    id: `ts-${over.week_start ?? '2026-08-03'}-${over.carer_id ?? 'carer-1'}`,
    household_id: 'h-1',
    carer_id: 'carer-1',
    carer_display_name: 'Marisol Reyes',
    week_start: '2026-08-03',
    total_minutes: 2400,
    status: 'approved',
    approved_by: 'parent-1',
    approved_at: '2026-08-10T09:30:00.000Z',
    query_note: null,
    reopen_reason: null,
    created_at: '2026-08-03T00:00:00.000Z',
    updated_at: '2026-08-10T09:30:00.000Z',
    gross_minor: 168_000,
    currency: 'USD',
    earnings: okSnapshot(168_000),
    earnings_computed_at: '2026-08-10T09:30:00.000Z',
    ...over,
  };
}

function makeService(
  rows: unknown[],
  overrides: { membership?: unknown } = {}
) {
  const membership = {
    id: 'm1',
    household_id: 'h-1',
    user_id: 'u1',
    role: 'parent',
    status: 'active',
  };
  const timesheetRepo: any = {
    listForHousehold: mock(async (_householdId: string, carerId?: string) =>
      carerId ? rows.filter((r: any) => r.carer_id === carerId) : rows
    ),
  };
  const memberRepo: any = {
    findMembershipAnyStatus: mock(async () =>
      overrides.membership === undefined ? membership : overrides.membership
    ),
  };
  const householdRepo: any = {
    findById: mock(async () => ({
      id: 'h-1',
      name: 'The Ahmeds',
      timezone: 'America/Chicago',
      currency: 'USD',
      week_starts_on: 0,
    })),
  };
  const service = new TimesheetQueryService(
    {} as any,
    timesheetRepo,
    memberRepo,
    householdRepo
  );
  return { service, timesheetRepo, householdRepo };
}

describe('exportCarerPaySummaryCsv — carer-scoped (D-29, 3-T2 read model)', () => {
  it('a nanny reading her own gets only her own weeks, regardless of a supplied carerId', async () => {
    const { service } = makeService(
      [tsRow(), tsRow({ carer_id: 'carer-2', week_start: '2026-08-10' })],
      { membership: { role: 'nanny', status: 'active', user_id: 'carer-1' } }
    );
    const { csv } = await service.exportCarerPaySummaryCsv('carer-1', 'h-1', {
      carerId: 'carer-2', // ignored — forced to her own
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(csv).toContain('weeks_included,1');
  });

  it('a parent must specify a carerId — refuses otherwise, never guesses', async () => {
    const { service } = makeService([tsRow()]);
    await expect(
      service.exportCarerPaySummaryCsv('u1', 'h-1', {
        from: '2026-01-01',
        to: '2026-12-31',
      })
    ).rejects.toBeInstanceOf(PaySummaryExportError);
  });

  it('a parent supplying carerId gets that carer’s weeks', async () => {
    const { service } = makeService([tsRow()]);
    const { csv } = await service.exportCarerPaySummaryCsv('u1', 'h-1', {
      carerId: 'carer-1',
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(csv).toContain('carer_display_name,Marisol Reyes');
    expect(csv).toContain('ytd_gross_minor,168000');
  });

  it('excludes a non-approved week from the range rather than refusing the whole export', async () => {
    const { service } = makeService([
      tsRow({ week_start: '2026-08-03' }),
      tsRow({ week_start: '2026-08-10', status: 'submitted' }),
    ]);
    const { csv } = await service.exportCarerPaySummaryCsv('u1', 'h-1', {
      carerId: 'carer-1',
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(csv).toContain('weeks_included,1');
  });

  it('excludes a week outside the requested range', async () => {
    const { service } = makeService([
      tsRow({
        week_start: '2025-08-03',
        approved_at: '2025-08-10T00:00:00.000Z',
      }),
    ]);
    const { csv } = await service.exportCarerPaySummaryCsv('u1', 'h-1', {
      carerId: 'carer-1',
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(csv).toContain('weeks_included,0');
  });

  it('refuses a range spanning more than one currency — never blends', async () => {
    const { service } = makeService([
      tsRow({ week_start: '2026-08-03', earnings: okSnapshot(168_000) }),
      tsRow({
        week_start: '2026-08-10',
        earnings: { ...okSnapshot(100_000), currency: 'GBP' },
      }),
    ]);
    await expect(
      service.exportCarerPaySummaryCsv('u1', 'h-1', {
        carerId: 'carer-1',
        from: '2026-01-01',
        to: '2026-12-31',
      })
    ).rejects.toBeInstanceOf(PaySummaryExportError);
  });
});

describe('exportYearEndSummaryCsv — the parent payroll handoff', () => {
  it('one row per carer in the household for the calendar year', async () => {
    const { service } = makeService([
      tsRow({ carer_id: 'carer-1', carer_display_name: 'Marisol Reyes' }),
      tsRow({
        carer_id: 'carer-2',
        carer_display_name: 'Nia Rowe',
        week_start: '2026-08-10',
        earnings: okSnapshot(112_000),
      }),
    ]);
    const { csv } = await service.exportYearEndSummaryCsv('u1', 'h-1', 2026);
    expect(csv).toContain('carers_included,2');
    expect(csv).toContain('total_gross_minor,280000');
  });

  it('excludes an unapproved week from every carer’s total', async () => {
    const { service } = makeService([tsRow({ status: 'submitted' })]);
    const { csv } = await service.exportYearEndSummaryCsv('u1', 'h-1', 2026);
    expect(csv).toContain('carers_included,0');
    expect(csv).toContain('total_gross_minor,0');
  });

  it('a nanny caller is forced to her own row only', async () => {
    const { service } = makeService(
      [
        tsRow({ carer_id: 'carer-1' }),
        tsRow({ carer_id: 'carer-2', week_start: '2026-08-10' }),
      ],
      { membership: { role: 'nanny', status: 'active', user_id: 'carer-1' } }
    );
    const { csv } = await service.exportYearEndSummaryCsv(
      'carer-1',
      'h-1',
      2026
    );
    expect(csv).toContain('carers_included,1');
  });
});
