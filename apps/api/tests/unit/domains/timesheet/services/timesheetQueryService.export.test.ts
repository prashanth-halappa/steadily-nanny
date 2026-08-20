/**
 * @module tests/unit/domains/timesheet/services/timesheetQueryService.export
 *
 * `exportWeekCsv` — the payroll handoff. Everything here defends ONE property:
 * a file handed to HomePay/Nannytax carries FROZEN figures or it does not
 * exist. The on-screen week degrades (hours-only) rather than blanking; the
 * export refuses rather than emitting a wrong-money artifact.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import type { WeekEarnings } from '@steadily-nanny/shared-types/schemas/timesheet.schema';

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_SNAPSHOT_AT = new Date(Date.now() - 2 * DAY_MS).toISOString();
const FIXTURE_PAYMENT_CREATED_AT = new Date(Date.now() - DAY_MS)
  .toISOString()
  .replace('.000Z', '+00:00');

/** One recorded payment — the export prints the ROW and derives the total. */
const PAID_30000: Payment = {
  id: 'pay-1',
  timesheet_id: 'ts-1',
  household_id: 'h-1',
  carer_id: 'carer-1',
  amount_minor: 30_000,
  kind: 'payment',
  corrects_payment_id: null,
  correction_reason: null,
  currency: 'GBP',
  paid_at: '2026-08-16',
  method_note: 'Zelle',
  recorded_by: 'parent-1',
  created_at: FIXTURE_PAYMENT_CREATED_AT,
};

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
  approved_at: FIXTURE_SNAPSHOT_AT,
  query_note: null,
  reopen_reason: null,
  created_at: '2026-08-03T00:00:00.000Z',
  updated_at: FIXTURE_SNAPSHOT_AT,
  gross_minor: 74_000,
  currency: 'GBP',
  earnings: snapshot,
  earnings_computed_at: FIXTURE_SNAPSHOT_AT,
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
    payments?: unknown[];
    membership?: unknown;
    anyStatusMembership?: unknown;
    household?: unknown;
    arrangement?: unknown;
    /** Active `household_members` rows — the Phase 5.1 ownerless-household check. */
    activeMembers?: unknown[];
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
    listActiveByHousehold: mock(async () => overrides.activeMembers ?? []),
  };
  const householdRepo: any = {
    findById: mock(async () =>
      overrides.household === undefined
        ? {
            id: 'h-1',
            name: 'The Ahmeds',
            timezone: 'Europe/London',
            week_starts_on: 1,
          }
        : overrides.household
    ),
  };
  const earnings: any = {
    computeForWeek: mock(async () => snapshot),
  };
  // The ROWS, not a total (D-20): the export derives paid-to-date from the
  // settlement rows it also prints, so the two can never disagree.
  const payments: any = {
    listForTimesheet: mock(async () => overrides.payments ?? []),
  };
  // 082/D-29: the effective arrangement, read ONLY for its pay_frequency/
  // pay_day fields — presentation grouping, never a second pricing source.
  const payArrangements: any = {
    effectiveOn: mock(async () =>
      overrides.arrangement === undefined ? null : overrides.arrangement
    ),
  };
  const service = new TimesheetQueryService(
    {} as any,
    timesheetRepo,
    memberRepo,
    householdRepo,
    earnings,
    payments,
    undefined,
    payArrangements
  );
  return {
    service,
    timesheetRepo,
    memberRepo,
    earnings,
    payments,
    householdRepo,
    payArrangements,
  };
}

describe('exportWeekCsv — the happy path', () => {
  it('serialises the FROZEN snapshot, never a recomputation', async () => {
    const { service, earnings, payments } = makeService(approvedRow, {
      payments: [PAID_30000],
    });

    const { csv, filename } = await service.exportWeekCsv('u1', 'ts-1');

    expect(earnings.computeForWeek).not.toHaveBeenCalled();
    expect(payments.listForTimesheet).toHaveBeenCalledWith('ts-1');
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
    expect(csv).toContain(`\r\napproved_at,${FIXTURE_SNAPSHOT_AT}\r\n`);
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

describe('exportWeekCsv — period-end + household identifier (082, D-29)', () => {
  it('adds household_display_name from the household row', async () => {
    const { service } = makeService(approvedRow, { payments: [] });
    const { csv } = await service.exportWeekCsv('u1', 'ts-1');
    expect(csv).toContain('household_display_name,The Ahmeds');
  });

  it('omits household_display_name when the household has no name available', async () => {
    const { service } = makeService(approvedRow, {
      payments: [],
      household: {
        id: 'h-1',
        name: '',
        timezone: 'Europe/London',
        week_starts_on: 1,
      },
    });
    const { csv } = await service.exportWeekCsv('u1', 'ts-1');
    expect(csv).not.toContain('household_display_name');
  });

  it('adds period_end for a WEEKLY arrangement — the period IS the week', async () => {
    const { service } = makeService(approvedRow, {
      payments: [],
      arrangement: {
        id: 'arr-1',
        pay_frequency: 'weekly',
        pay_day_of_week: null,
        pay_day_of_month: null,
        valid_from: '2026-01-01',
      },
    });
    const { csv } = await service.exportWeekCsv('u1', 'ts-1');
    // approvedRow.week_start is 2026-08-03 (Monday) -> inclusive end 2026-08-09.
    expect(csv).toContain('period_end,2026-08-09');
  });

  it('omits period_end entirely when no arrangement resolves for the week', async () => {
    const { service } = makeService(approvedRow, {
      payments: [],
      arrangement: null,
    });
    const { csv } = await service.exportWeekCsv('u1', 'ts-1');
    expect(csv).not.toContain('period_end');
  });

  it('omits period_end when the resolved arrangement has no pay_frequency stated', async () => {
    const { service } = makeService(approvedRow, {
      payments: [],
      arrangement: {
        id: 'arr-1',
        pay_frequency: null,
        pay_day_of_week: null,
        pay_day_of_month: null,
        valid_from: '2026-01-01',
      },
    });
    const { csv } = await service.exportWeekCsv('u1', 'ts-1');
    expect(csv).not.toContain('period_end');
  });

  it('resolves the arrangement effective on the week — never recomputed money, presentation only', async () => {
    const { service, payArrangements } = makeService(approvedRow, {
      payments: [],
      arrangement: {
        id: 'arr-1',
        pay_frequency: 'monthly',
        pay_day_of_week: null,
        pay_day_of_month: null,
        valid_from: '2026-01-01',
      },
    });
    await service.exportWeekCsv('u1', 'ts-1');
    expect(payArrangements.effectiveOn).toHaveBeenCalledWith(
      'h-1',
      'carer-1',
      '2026-08-09'
    );
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
      expect(payments.listForTimesheet).not.toHaveBeenCalled();
    });
  }
});

/**
 * Phase 5.1 — her evidence. When the household has nobody left who can
 * approve a week (every owner/parent has gone), an approval-gated export
 * would refuse forever, and hers is the one artifact a tribunal might
 * actually ask for. ONE carved exception: she, on HER OWN week, in a
 * household with no active owner/parent — nobody else, no other combination.
 */
describe('exportWeekCsv — her own unapproved week, in a household nobody can approve for', () => {
  const unapprovedOwnRow = {
    ...approvedRow,
    status: 'open',
    approved_at: null,
    earnings: null,
  };

  it('exports when she is the carer and the household has no active owner/parent', async () => {
    const { service, earnings, memberRepo } = makeService(unapprovedOwnRow, {
      // assertPayrollReader reads findMembershipAnyStatus, NOT
      // findActiveMembership — the scope (and therefore whether this read
      // counts as "her own") turns on THIS override.
      anyStatusMembership: { ...membership, role: 'nanny', status: 'active' },
      activeMembers: [
        {
          id: 'm1',
          household_id: 'h-1',
          user_id: 'carer-1',
          role: 'nanny',
          status: 'active',
        },
      ],
    });

    const { csv } = await service.exportWeekCsv('carer-1', 'ts-1');

    expect(memberRepo.listActiveByHousehold).toHaveBeenCalledWith('h-1');
    // No frozen snapshot exists for an unapproved week — the live engine has
    // to be asked, same computation the on-screen week already uses.
    expect(earnings.computeForWeek).toHaveBeenCalledWith(
      'h-1',
      'carer-1',
      '2026-08-03'
    );
    expect(csv).toContain('total_gross_minor,74000');
    expect(csv).toContain('export_notice,');
    expect(csv).not.toContain('approved_at');
  });

  it('STILL refuses when a co-parent/owner remains active — the ordinary case does not regress', async () => {
    const { service, earnings } = makeService(unapprovedOwnRow, {
      anyStatusMembership: { ...membership, role: 'nanny', status: 'active' },
      activeMembers: [
        {
          id: 'm1',
          household_id: 'h-1',
          user_id: 'carer-1',
          role: 'nanny',
          status: 'active',
        },
        {
          id: 'm2',
          household_id: 'h-1',
          user_id: 'u1',
          role: 'parent',
          status: 'active',
        },
      ],
    });

    const error = await service
      .exportWeekCsv('carer-1', 'ts-1')
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TimesheetNotExportableError);
    expect((error as any).metadata).toMatchObject({
      exportReason: 'not_approved',
    });
    expect(earnings.computeForWeek).not.toHaveBeenCalled();
  });

  it("still refuses another carer's unapproved week even in an ownerless household", async () => {
    // A nanny's read scope is 'own', pinned to the CALLING user's id
    // (assertPayrollReader), so calling as carer-2 against carer-1's row
    // never resolves the row at all — TimesheetNotFoundError, same as
    // any other "not yours" case, well before the new gate runs.
    const { service, memberRepo } = makeService(unapprovedOwnRow, {
      anyStatusMembership: {
        ...membership,
        user_id: 'carer-2',
        role: 'nanny',
        status: 'active',
      },
      activeMembers: [
        {
          id: 'm1',
          household_id: 'h-1',
          user_id: 'carer-1',
          role: 'nanny',
          status: 'active',
        },
        {
          id: 'm2',
          household_id: 'h-1',
          user_id: 'carer-2',
          role: 'nanny',
          status: 'active',
        },
      ],
    });

    const error = await service
      .exportWeekCsv('carer-2', 'ts-1')
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TimesheetNotFoundError);
    // Not her row at all — the export's own gate is never even reached.
    expect(memberRepo.listActiveByHousehold).not.toHaveBeenCalled();
  });

  it('still refuses a parent asking for an unapproved week', async () => {
    // Default `membership` fixture is already role 'parent' — a parent's
    // scope is household-wide, so the row resolves regardless of carer_id;
    // the refusal has to come from exportWeekCsv's own carer-identity check.
    const { service, memberRepo } = makeService(unapprovedOwnRow, {
      activeMembers: [],
    });

    const error = await service
      .exportWeekCsv('u1', 'ts-1')
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TimesheetNotExportableError);
    // 'u1' is not the row's carer ('carer-1') — refused before the household
    // is even asked who else is active.
    expect(memberRepo.listActiveByHousehold).not.toHaveBeenCalled();
  });
});

describe('exportWeekCsv — an approved week is unaffected by the Phase 5.1 exception', () => {
  it('never carries export_notice, and never asks who else is active', async () => {
    const { service, memberRepo } = makeService(approvedRow, {
      payments: [PAID_30000],
    });

    const { csv } = await service.exportWeekCsv('u1', 'ts-1');

    expect(csv).not.toContain('export_notice');
    expect(memberRepo.listActiveByHousehold).not.toHaveBeenCalled();
  });
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
