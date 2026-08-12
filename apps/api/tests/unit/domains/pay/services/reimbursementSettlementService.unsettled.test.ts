/**
 * Household-wide unsettled reimbursement aggregate — `listUnsettled`.
 * Read scope mirrors `timesheetQueryService.assertPayrollReader` (D-21).
 */
import { describe, expect, it, mock } from 'bun:test';
import { ReimbursementSettlementNotFoundError } from '../../../../../src/domains/pay/errors/payErrors';
import { ReimbursementSettlementService } from '../../../../../src/domains/pay/services/reimbursementSettlementService';
import { TimesheetNotFoundError } from '../../../../../src/domains/timesheet/errors/timesheetErrors';

const PARENT = {
  id: 'm-parent',
  household_id: 'h1',
  user_id: 'parent-1',
  role: 'parent',
  status: 'active',
};
const NANNY = {
  id: 'm-nanny',
  household_id: 'h1',
  user_id: 'carer-1',
  role: 'nanny',
  status: 'active',
};
const OTHER_NANNY = {
  id: 'm-nanny-2',
  household_id: 'h1',
  user_id: 'carer-2',
  role: 'nanny',
  status: 'active',
};
const HELPER = {
  id: 'm-helper',
  household_id: 'h1',
  user_id: 'helper-1',
  role: 'helper',
  status: 'active',
};

function approvedClaim(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'e1',
    household_id: 'h1',
    carer_id: 'carer-1',
    local_date: '2026-08-04',
    kind: 'expense',
    description: 'Craft supplies',
    amount_minor: 1_250,
    miles: null,
    currency: 'GBP',
    status: 'approved',
    reviewed_by: 'parent-1',
    reviewed_at: '2026-08-05T09:00:00.000Z',
    review_note: null,
    created_at: '2026-08-04T09:00:00.000Z',
    updated_at: '2026-08-05T09:00:00.000Z',
    ...overrides,
  };
}

function makePayrollReader(
  scope: { kind: 'household' } | { kind: 'own'; carerId: string }
) {
  return {
    resolvePayrollReadScope: mock(async () => scope),
  };
}

function service(
  parts: {
    payrollReader?: ReturnType<typeof makePayrollReader>;
    approved?: Record<string, unknown>[];
    settlements?: Record<string, unknown>[];
    payrollThrows?: Error;
  } = {}
) {
  const payrollReader =
    parts.payrollReader ??
    (parts.payrollThrows
      ? {
          resolvePayrollReadScope: mock(async () => {
            throw parts.payrollThrows;
          }),
        }
      : makePayrollReader({ kind: 'household' }));

  return new ReimbursementSettlementService(
    {
      listForHousehold: mock(async () => parts.settlements ?? []),
      listForWeek: mock(async () => []),
      create: mock(async () => ({})),
    } as any,
    {
      listApprovedForHousehold: mock(
        async () => parts.approved ?? [approvedClaim()]
      ),
      listApprovedForWeek: mock(async () => []),
    } as any,
    {
      findActiveMembership: mock(async () => null),
      findMembershipAnyStatus: mock(async () => null),
    } as any,
    {
      findById: mock(async () => ({
        id: 'h1',
        timezone: 'Europe/London',
        week_starts_on: 1,
        currency: 'GBP',
      })),
    } as any,
    { notifyUser: mock(() => undefined) },
    payrollReader
  );
}

describe('ReimbursementSettlementService.listUnsettled — read scope (assertPayrollReader)', () => {
  it('a parent sees every carer’s unsettled weeks', async () => {
    const svc = service({
      approved: [
        approvedClaim({ id: 'e1', amount_minor: 1_000 }),
        approvedClaim({
          id: 'e2',
          carer_id: 'carer-2',
          amount_minor: 2_000,
        }),
      ],
    });
    const rows = await svc.listUnsettled('parent-1', 'h1');
    expect(rows.map((r: { carer_id: string }) => r.carer_id).sort()).toEqual([
      'carer-1',
      'carer-2',
    ]);
  });

  it('a nanny sees ONLY her own unsettled weeks', async () => {
    const svc = service({
      payrollReader: makePayrollReader({ kind: 'own', carerId: 'carer-1' }),
      approved: [
        approvedClaim({ id: 'e1', amount_minor: 1_000 }),
        approvedClaim({
          id: 'e2',
          carer_id: 'carer-2',
          amount_minor: 2_000,
        }),
      ],
    });
    const rows = await svc.listUnsettled('carer-1', 'h1');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.carer_id).toBe('carer-1');
    expect(row?.amount_minor).toBe(1_000);
  });

  it('a helper is denied with the opaque 404', async () => {
    const svc = service({
      payrollThrows: new TimesheetNotFoundError('h1', {
        reason: 'household_not_accessible',
      }),
    });
    await expect(svc.listUnsettled('helper-1', 'h1')).rejects.toBeInstanceOf(
      ReimbursementSettlementNotFoundError
    );
  });
});

describe('ReimbursementSettlementService.listUnsettled — unsettled math', () => {
  it('sums approved claims per carer-week in integer minor units with currency', async () => {
    const svc = service({
      approved: [
        approvedClaim({ id: 'e1', amount_minor: 1_250 }),
        approvedClaim({ id: 'e2', amount_minor: 990 }),
      ],
    });
    const rows = await svc.listUnsettled('parent-1', 'h1');
    expect(rows).toEqual([
      {
        carer_id: 'carer-1',
        week_start: '2026-08-03',
        amount_minor: 2_240,
        currency: 'GBP',
      },
    ]);
  });

  it('excludes carer-weeks that already have a settlement', async () => {
    const svc = service({
      approved: [approvedClaim({ amount_minor: 5_000 })],
      settlements: [
        {
          id: 'set-1',
          household_id: 'h1',
          carer_id: 'carer-1',
          week_start: '2026-08-03',
          amount_minor: 5_000,
          currency: 'GBP',
          settled_at: '2026-08-10',
          note: null,
          recorded_by: 'parent-1',
          created_at: '2026-08-10T09:00:00.000Z',
        },
      ],
    });
    expect(await svc.listUnsettled('parent-1', 'h1')).toEqual([]);
  });

  it('returns an empty list when nothing is owed — never a zero row', async () => {
    const svc = service({ approved: [] });
    expect(await svc.listUnsettled('parent-1', 'h1')).toEqual([]);
  });

  it('skips a carer-week with currency mismatch — no item with a blank figure', async () => {
    const svc = service({
      approved: [
        approvedClaim({ id: 'e1', amount_minor: 1_000, currency: 'GBP' }),
        approvedClaim({ id: 'e2', amount_minor: 500, currency: 'USD' }),
      ],
    });
    expect(await svc.listUnsettled('parent-1', 'h1')).toEqual([]);
  });

  it('skips approved rows with null amount_minor', async () => {
    const svc = service({
      approved: [approvedClaim({ amount_minor: null })],
    });
    expect(await svc.listUnsettled('parent-1', 'h1')).toEqual([]);
  });
});
