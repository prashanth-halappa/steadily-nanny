/**
 * @module tests/unit/domains/timesheet/services/timesheetQueryService.yearEndDeparted
 *
 * THE YEAR-END TAX CSV MUST OUTLIVE THE ACCOUNT (033/058, Form 2441 / FSA).
 *
 * A carer who worked January–June and deleted her account in July leaves the
 * household's payroll rows behind: `carer_id` NULL, `carer_display_name`
 * snapshotted, `household_member_id` still stamped. The parent's year-end
 * handoff is the ONE report whose entire reason to exist is reporting that
 * history — dropping her gross from it is the failure that costs the family
 * money at the exact moment nobody can re-derive the figure.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

let TimesheetQueryService: typeof import('../../../../../src/domains/timesheet/services/timesheetQueryService').TimesheetQueryService;

beforeAll(async () => {
  mock.module('../../../../../src/middlewares/logger', () => ({
    logger: {
      info: mock(() => undefined),
      warn: mock(() => undefined),
      error: mock(() => undefined),
      debug: mock(() => undefined),
    },
  }));
  TimesheetQueryService = (
    await import(
      '../../../../../src/domains/timesheet/services/timesheetQueryService'
    )
  ).TimesheetQueryService;
});

const DAY_MS = 24 * 60 * 60 * 1000;
const APPROVED_AT = new Date(Date.now() - 2 * DAY_MS).toISOString();

const okSnapshot = (grossMinor: number, reimbursementsMinor = 0) => ({
  status: 'ok',
  week_start: '2026-03-02',
  currency: 'USD',
  lines: [],
  gross_minor: grossMinor,
  reimbursements_minor: reimbursementsMinor,
  worked_minutes: 0,
  payable_minutes: 0,
  guaranteed_minutes_per_week: null,
});

function tsRow(over: Record<string, unknown> = {}): any {
  const grossMinor = (over.gross_minor as number) ?? 168_000;
  return {
    id: `ts-${over.week_start ?? '2026-03-02'}-${over.carer_display_name ?? 'x'}`,
    household_id: 'h-1',
    carer_id: 'carer-1',
    carer_display_name: 'Marisol Reyes',
    household_member_id: 'hm-1',
    week_start: '2026-03-02',
    total_minutes: 2400,
    status: 'approved',
    approved_by: 'parent-1',
    approved_at: APPROVED_AT,
    query_note: null,
    reopen_reason: null,
    created_at: '2026-03-02T00:00:00.000Z',
    updated_at: APPROVED_AT,
    currency: 'USD',
    earnings_computed_at: APPROVED_AT,
    ...over,
    gross_minor: grossMinor,
    earnings:
      over.earnings ??
      okSnapshot(grossMinor, (over.reimbursements_minor as number) ?? 0),
  };
}

/** Marisol is still here. Emma deleted her account in July (033/058). */
const ACTIVE_WEEK = tsRow({
  week_start: '2026-03-02',
  carer_id: 'carer-1',
  carer_display_name: 'Marisol Reyes',
  household_member_id: 'hm-1',
  gross_minor: 168_000,
});
const DEPARTED_WEEK = tsRow({
  week_start: '2026-04-06',
  carer_id: null,
  carer_display_name: 'Emma Clarke',
  household_member_id: 'hm-2',
  gross_minor: 90_000,
  reimbursements_minor: 1_250,
});

function makeService(rows: unknown[]) {
  const timesheetRepo: any = {
    listForHousehold: mock(async (_householdId: string, carerId?: string) =>
      carerId ? rows.filter((r: any) => r.carer_id === carerId) : rows
    ),
  };
  const memberRepo: any = {
    findMembershipAnyStatus: mock(async () => ({
      id: 'm1',
      household_id: 'h-1',
      user_id: 'parent-1',
      role: 'parent',
      status: 'active',
    })),
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
  return new TimesheetQueryService(
    {} as any,
    timesheetRepo,
    memberRepo,
    householdRepo
  );
}

describe('exportYearEndSummaryCsv — a carer who deleted her account (033/058)', () => {
  it('reports the departed carer alongside the active one, under her snapshotted name', async () => {
    const service = makeService([ACTIVE_WEEK, DEPARTED_WEEK]);

    const { csv } = await service.exportYearEndSummaryCsv(
      'parent-1',
      'h-1',
      2026
    );

    expect(csv).toContain('Marisol Reyes,168000,0,1,USD');
    expect(csv).toContain('Emma Clarke,90000,1250,1,USD');
    expect(csv).toContain('carers_included,2');
    expect(csv).toContain('total_gross_minor,258000');
    expect(csv).toContain('total_reimbursements_minor,1250');
  });

  it('keeps two departed carers apart on their household_member_id stamps', async () => {
    const service = makeService([
      DEPARTED_WEEK,
      tsRow({
        week_start: '2026-05-04',
        carer_id: null,
        carer_display_name: 'Emma Clarke',
        household_member_id: 'hm-3',
        gross_minor: 40_000,
      }),
    ]);

    const { csv } = await service.exportYearEndSummaryCsv(
      'parent-1',
      'h-1',
      2026
    );

    expect(csv).toContain('carers_included,2');
    expect(csv).toContain('Emma Clarke,90000,1250,1,USD');
    expect(csv).toContain('Emma Clarke,40000,0,1,USD');
    expect(csv).toContain('total_gross_minor,130000');
  });

  it('still sums a departed carer’s own weeks into ONE row', async () => {
    const service = makeService([
      DEPARTED_WEEK,
      tsRow({
        week_start: '2026-05-04',
        carer_id: null,
        carer_display_name: 'Emma Clarke',
        household_member_id: 'hm-2',
        gross_minor: 40_000,
      }),
    ]);

    const { csv } = await service.exportYearEndSummaryCsv(
      'parent-1',
      'h-1',
      2026
    );

    expect(csv).toContain('carers_included,1');
    expect(csv).toContain('Emma Clarke,130000,1250,2,USD');
  });

  it('does not resurrect a week outside the year, departed or not', async () => {
    const service = makeService([
      DEPARTED_WEEK,
      tsRow({
        week_start: '2025-11-03',
        carer_id: null,
        carer_display_name: 'Emma Clarke',
        household_member_id: 'hm-2',
        gross_minor: 40_000,
      }),
    ]);

    const { csv } = await service.exportYearEndSummaryCsv(
      'parent-1',
      'h-1',
      2026
    );

    expect(csv).toContain('carers_included,1');
    expect(csv).toContain('Emma Clarke,90000,1250,1,USD');
  });
});
