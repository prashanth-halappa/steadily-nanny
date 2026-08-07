import { describe, expect, it, mock } from 'bun:test';
import { PaymentNotFoundError } from '../../../../../src/domains/pay/errors/payErrors';
import { PaymentQueryService } from '../../../../../src/domains/pay/services/paymentQueryService';

/**
 * `paymentQueryService.listForTimesheet` — who may see what a week was paid.
 *
 * | caller                                | sees                |
 * |---------------------------------------|---------------------|
 * | active `owner`/`parent` of the week's household | the week's payments |
 * | the week's OWN carer                  | the week's payments |
 * | another `nanny` of the household      | denied              |
 * | `helper`                              | denied              |
 * | non-member                            | denied              |
 *
 * That is migration 067's select policy
 * (`can_write_household(household_id) or carer_id = auth.uid()`) restated in
 * the service, because repositories run as the service role and bypass RLS —
 * a service looser than the policy on the same table is a real hole, not a
 * cosmetic one (`docs/11-MONEY.md` §8). Every denial is the SAME
 * `PaymentNotFoundError`, so a caller learns nothing about a week that isn't
 * hers.
 */

const APPROVED_TIMESHEET = {
  id: 'ts-1',
  household_id: 'h1',
  carer_id: 'carer-1',
  week_start: '2026-08-03',
  status: 'approved',
  gross_minor: 80_000,
  currency: 'GBP',
};

const PAYMENTS = [
  {
    id: 'pay-1',
    timesheet_id: 'ts-1',
    household_id: 'h1',
    carer_id: 'carer-1',
    amount_minor: 5_000,
    currency: 'GBP',
    paid_at: '2026-08-11',
    method_note: 'Bank transfer',
    recorded_by: 'parent-1',
    created_at: '2026-08-11T10:00:00.000Z',
  },
];

function makePaymentRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForTimesheet: mock(async () => PAYMENTS),
    ...overrides,
  };
}

function makeTimesheetRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => ({ ...APPROVED_TIMESHEET })),
    ...overrides,
  };
}

function membership(role: string, userId: string, status = 'active'): unknown {
  return {
    id: `m-${userId}`,
    household_id: 'h1',
    user_id: userId,
    role,
    status,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveMembership: mock(async () => membership('parent', 'parent-1')),
    ...overrides,
  };
}

function makeService(overrides: Record<string, unknown> = {}): any {
  const deps = {
    paymentRepo: makePaymentRepo(),
    timesheetRepo: makeTimesheetRepo(),
    memberRepo: makeMemberRepo(),
    ...overrides,
  };
  return {
    ...deps,
    svc: new PaymentQueryService(
      deps.paymentRepo,
      deps.timesheetRepo,
      deps.memberRepo
    ),
  };
}

describe('PaymentQueryService.listForTimesheet', () => {
  it('a parent of the household reads the week’s payments', async () => {
    const { svc, paymentRepo } = makeService();

    const rows = await svc.listForTimesheet('parent-1', 'ts-1');

    expect(rows).toEqual(PAYMENTS);
    expect(paymentRepo.listForTimesheet).toHaveBeenCalledWith('ts-1');
  });

  it('an owner reads them too', async () => {
    const { svc } = makeService({
      memberRepo: makeMemberRepo({
        findActiveMembership: mock(async () => membership('owner', 'owner-1')),
      }),
    });

    expect(await svc.listForTimesheet('owner-1', 'ts-1')).toEqual(PAYMENTS);
  });

  it('the week’s OWN carer reads them — opaque pay is the disease this feature treats', async () => {
    const { svc } = makeService({
      memberRepo: makeMemberRepo({
        findActiveMembership: mock(async () => membership('nanny', 'carer-1')),
      }),
    });

    expect(await svc.listForTimesheet('carer-1', 'ts-1')).toEqual(PAYMENTS);
  });

  it('a DIFFERENT nanny of the same household is denied — one carer never sees another’s money', async () => {
    const { svc, paymentRepo } = makeService({
      memberRepo: makeMemberRepo({
        findActiveMembership: mock(async () => membership('nanny', 'carer-2')),
      }),
    });

    await expect(svc.listForTimesheet('carer-2', 'ts-1')).rejects.toThrow(
      PaymentNotFoundError
    );
    expect(paymentRepo.listForTimesheet).not.toHaveBeenCalled();
  });

  it('a helper is denied — a helper never sees pay', async () => {
    const { svc, paymentRepo } = makeService({
      memberRepo: makeMemberRepo({
        findActiveMembership: mock(async () =>
          membership('helper', 'helper-1')
        ),
      }),
    });

    await expect(svc.listForTimesheet('helper-1', 'ts-1')).rejects.toThrow(
      PaymentNotFoundError
    );
    expect(paymentRepo.listForTimesheet).not.toHaveBeenCalled();
  });

  it('a non-member is denied', async () => {
    const { svc } = makeService({
      memberRepo: makeMemberRepo({
        findActiveMembership: mock(async () => null),
      }),
    });

    await expect(svc.listForTimesheet('stranger-1', 'ts-1')).rejects.toThrow(
      PaymentNotFoundError
    );
  });

  it('a missing timesheet is the SAME error as a forbidden one', async () => {
    const { svc } = makeService({
      timesheetRepo: makeTimesheetRepo({ findById: mock(async () => null) }),
    });

    await expect(svc.listForTimesheet('parent-1', 'ts-nope')).rejects.toThrow(
      PaymentNotFoundError
    );
  });

  it('a REMOVED carer still reads the week she was paid for — payroll is an audit trail', async () => {
    // `findActiveMembership` returns null for her, but 067's select policy
    // arms on `carer_id`, not on membership: she is on the row.
    const { svc } = makeService({
      memberRepo: makeMemberRepo({
        findActiveMembership: mock(async () => null),
      }),
    });

    expect(await svc.listForTimesheet('carer-1', 'ts-1')).toEqual(PAYMENTS);
  });

  it('reads membership against the TIMESHEET’s household', async () => {
    const { svc, memberRepo } = makeService();

    await svc.listForTimesheet('parent-1', 'ts-1');

    expect(memberRepo.findActiveMembership).toHaveBeenCalledWith(
      'h1',
      'parent-1'
    );
  });
});
