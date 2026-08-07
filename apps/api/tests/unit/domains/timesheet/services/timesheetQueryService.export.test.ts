/**
 * @module tests/unit/domains/timesheet/services/timesheetQueryService.export
 *
 * `exportWeekCsv` — the payroll handoff. Everything here defends ONE property:
 * a file handed to HomePay/Nannytax carries FROZEN figures or it does not
 * exist. The on-screen week degrades (hours-only) rather than blanking; the
 * export refuses rather than emitting a wrong-money artifact.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { WeekEarnings } from '@steadily-nanny/shared-types/schemas/timesheet.schema';

let TimesheetQueryService: typeof import('../../../../../src/domains/timesheet/services/timesheetQueryService').TimesheetQueryService;
let TimesheetNotExportableError: typeof import('../../../../../src/domains/timesheet/errors/timesheetErrors').TimesheetNotExportableError;
let TimesheetNotFoundError: typeof import('../../../../../src/domains/timesheet/errors/timesheetErrors').TimesheetNotFoundError;

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
  const errors = await import(
    '../../../../../src/domains/timesheet/errors/timesheetErrors'
  );
  TimesheetNotExportableError = errors.TimesheetNotExportableError;
  TimesheetNotFoundError = errors.TimesheetNotFoundError;
});

const snapshot: WeekEarnings = {
  status: 'ok',
  week_start: '2026-08-03',
  currency: 'GBP',
  lines: [
    {
      kind: 'regular',
      minutes: 2400,
      rate_minor: 1850,
      multiplier: null,
      amount_minor: 74_000,
      from_date: '2026-08-03',
      to_date: '2026-08-07',
      arrangement_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  ],
  gross_minor: 74_000,
  reimbursements_minor: 0,
  worked_minutes: 2400,
  payable_minutes: 2400,
  guaranteed_minutes_per_week: null,
};

const approvedRow: any = {
  id: 'ts-1',
  household_id: 'h-1',
  carer_id: 'carer-1',
  carer_display_name: 'Nia Rowe',
  week_start: '2026-08-03',
  total_minutes: 2400,
  status: 'approved',
  approved_by: 'parent-1',
  approved_at: '2026-08-10T09:30:00.000Z',
  query_note: null,
  reopen_reason: null,
  created_at: '2026-08-03T00:00:00.000Z',
  updated_at: '2026-08-10T09:30:00.000Z',
  gross_minor: 74_000,
  currency: 'GBP',
  earnings: snapshot,
  earnings_computed_at: '2026-08-10T09:30:00.000Z',
};

const membership = {
  id: 'm1',
  household_id: 'h-1',
  user_id: 'u1',
  role: 'parent',
  status: 'active',
};

function makeService(
  row: unknown,
  overrides: {
    paidToDateMinor?: number;
    membership?: unknown;
    anyStatusMembership?: unknown;
  } = {}
) {
  const timesheetRepo: any = { findById: mock(async () => row) };
  const memberRepo: any = {
    findActiveMembership: mock(async () =>
      overrides.membership === undefined ? membership : overrides.membership
    ),
    findMembershipAnyStatus: mock(async () =>
      overrides.anyStatusMembership === undefined
        ? membership
        : overrides.anyStatusMembership
    ),
  };
  const householdRepo: any = {
    findById: mock(async () => ({ id: 'h-1', timezone: 'Europe/London' })),
  };
  const earnings: any = {
    computeForWeek: mock(async () => snapshot),
  };
  const payments: any = {
    sumForTimesheet: mock(async () => overrides.paidToDateMinor ?? 0),
  };
  const service = new TimesheetQueryService(
    {} as any,
    timesheetRepo,
    memberRepo,
    householdRepo,
    earnings,
    payments
  );
  return { service, timesheetRepo, memberRepo, earnings, payments };
}

describe('exportWeekCsv — the happy path', () => {
  it('serialises the FROZEN snapshot, never a recomputation', async () => {
    const { service, earnings, payments } = makeService(approvedRow, {
      paidToDateMinor: 30_000,
    });

    const { csv, filename } = await service.exportWeekCsv('u1', 'ts-1');

    expect(earnings.computeForWeek).not.toHaveBeenCalled();
    expect(payments.sumForTimesheet).toHaveBeenCalledWith('ts-1');
    expect(filename).toBe('steadily-week-2026-08-03-nia-rowe.csv');
    expect(csv).toContain(
      'date,description,kind,minutes,rate_minor,amount_minor,currency\r\n'
    );
    expect(csv).toContain(
      '2026-08-03,Regular hours (to 2026-08-07),regular,2400,1850,74000,GBP\r\n'
    );
    expect(csv).toContain('\r\ntotal_gross_minor,74000\r\n');
    expect(csv).toContain('\r\npaid_to_date_minor,30000\r\n');
    expect(csv).toContain('\r\nbalance_due_minor,44000\r\n');
    expect(csv).toContain('\r\napproved_at,2026-08-10T09:30:00.000Z\r\n');
  });

  it('exports for a REMOVED nanny reading her own week — the same gate as the week read', async () => {
    const { service } = makeService(approvedRow, {
      membership: null,
      anyStatusMembership: {
        ...membership,
        user_id: 'carer-1',
        role: 'nanny',
        status: 'removed',
      },
    });

    const { csv } = await service.exportWeekCsv('carer-1', 'ts-1');
    expect(csv).toContain('total_gross_minor,74000');
  });
});

describe('exportWeekCsv — the read gate is the week read gate, unchanged', () => {
  it('throws TimesheetNotFoundError for a non-member (no existence leak)', async () => {
    const { service } = makeService(approvedRow, {
      membership: null,
      anyStatusMembership: null,
    });

    await expect(
      service.exportWeekCsv('stranger', 'ts-1')
    ).rejects.toBeInstanceOf(TimesheetNotFoundError);
  });

  it('throws TimesheetNotFoundError for a missing timesheet', async () => {
    const { service } = makeService(null);

    await expect(service.exportWeekCsv('u1', 'ts-1')).rejects.toBeInstanceOf(
      TimesheetNotFoundError
    );
  });

  it("refuses a removed nanny another carer's week", async () => {
    const { service } = makeService(approvedRow, {
      membership: null,
      anyStatusMembership: {
        ...membership,
        user_id: 'carer-2',
        role: 'nanny',
        status: 'removed',
      },
    });

    await expect(
      service.exportWeekCsv('carer-2', 'ts-1')
    ).rejects.toBeInstanceOf(TimesheetNotFoundError);
  });
});

describe('exportWeekCsv — only an APPROVED week exports', () => {
  for (const status of ['open', 'submitted', 'queried'] as const) {
    it(`refuses a ${status} week with TimesheetNotExportableError, and never prices it`, async () => {
      const { service, earnings, payments } = makeService({
        ...approvedRow,
        status,
      });

      const error = await service
        .exportWeekCsv('u1', 'ts-1')
        .then(() => null)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(TimesheetNotExportableError);
      expect((error as any).statusCode).toBe(409);
      expect((error as any).metadata).toMatchObject({
        timesheetId: 'ts-1',
        status,
        exportReason: 'not_approved',
      });
      // No live estimate is ever computed for an export, and no payment read
      // happens for a week that cannot be exported.
      expect(earnings.computeForWeek).not.toHaveBeenCalled();
      expect(payments.sumForTimesheet).not.toHaveBeenCalled();
    });
  }
});

describe('exportWeekCsv — a degraded snapshot refuses rather than lying', () => {
  it('refuses an unreadable snapshot (the hoursOnly path) instead of emitting wrong money', async () => {
    const { service } = makeService({
      ...approvedRow,
      earnings: { status: 'ok', gross_minor: 'lots' },
    });

    const error = await service
      .exportWeekCsv('u1', 'ts-1')
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TimesheetNotExportableError);
    expect((error as any).metadata).toMatchObject({
      exportReason: 'unreadable_snapshot',
    });
  });

  it('refuses a legacy approval with a NULL snapshot', async () => {
    const { service } = makeService({ ...approvedRow, earnings: null });

    const error = await service
      .exportWeekCsv('u1', 'ts-1')
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TimesheetNotExportableError);
    expect((error as any).metadata).toMatchObject({
      exportReason: 'legacy_approval',
    });
  });

  it('refuses a week whose carer deleted her account (no carer to price against)', async () => {
    const { service } = makeService({ ...approvedRow, carer_id: null });

    const error = await service
      .exportWeekCsv('u1', 'ts-1')
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TimesheetNotExportableError);
    expect((error as any).metadata).toMatchObject({
      exportReason: 'carer_removed',
    });
  });
});
