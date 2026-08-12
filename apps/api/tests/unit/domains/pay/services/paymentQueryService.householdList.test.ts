import { describe, expect, it, mock } from 'bun:test';
import { PaymentNotFoundError } from '../../../../../src/domains/pay/errors/payErrors';
import { PaymentQueryService } from '../../../../../src/domains/pay/services/paymentQueryService';

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_TS = new Date(Date.now() - 1 * DAY_MS).toISOString();

/**
 * `paymentQueryService.listForHousehold` — the household-scoped payments
 * read, and the gate in front of it.
 *
 * | caller                  | sees                                    |
 * |-------------------------|-----------------------------------------|
 * | active `owner`/`parent` | every carer's payments in the household |
 * | active `nanny`          | HER OWN rows, and only hers             |
 * | REMOVED `nanny`         | her own rows still — payroll is an audit trail |
 * | removed `owner`/`parent`| the whole household still               |
 * | `helper` (either status)| denied                                  |
 * | non-member              | denied                                  |
 *
 * This is `timesheetQueryService.assertPayrollReader` restated on the money
 * table: `findMembershipAnyStatus`, not `findActiveMembership`, because a
 * carer who has since been removed must still read what she was paid — the
 * same argument migration 067's `carer_id = auth.uid()` policy arm makes.
 *
 * The carer scope is FORCED, never merely offered: the repo is called with
 * her own id no matter what filter the client supplied, so a nanny cannot
 * widen her own scope to the household's. Same enforcement point as
 * `timesheetQueryService.listTimesheetsForHousehold` and
 * `expenseQueryService.scopeRows`.
 *
 * Every denial is the SAME `PaymentNotFoundError` and happens BEFORE the
 * repo is touched — hence the `not.toHaveBeenCalled()` assertions.
 */

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
    created_at: FIXTURE_TS,
  },
];

function membership(role: string, userId: string, status = 'active'): unknown {
  return {
    id: `m-${userId}`,
    household_id: 'h1',
    user_id: userId,
    role,
    status,
  };
}

function makeService(member: unknown): any {
  const paymentRepo: any = { listForHousehold: mock(async () => PAYMENTS) };
  const timesheetRepo: any = { findById: mock(async () => null) };
  const memberRepo: any = { findMembershipAnyStatus: mock(async () => member) };
  return {
    paymentRepo,
    memberRepo,
    svc: new PaymentQueryService(paymentRepo, timesheetRepo, memberRepo),
  };
}

describe('PaymentQueryService.listForHousehold — household scope', () => {
  it('an active parent sees every carer’s rows', async () => {
    const { svc, paymentRepo } = makeService(membership('parent', 'parent-1'));

    const rows = await svc.listForHousehold('parent-1', 'h1');

    expect(rows).toEqual(PAYMENTS);
    expect(paymentRepo.listForHousehold).toHaveBeenCalledWith('h1', undefined);
  });

  it('an active owner sees every carer’s rows', async () => {
    const { svc, paymentRepo } = makeService(membership('owner', 'owner-1'));

    expect(await svc.listForHousehold('owner-1', 'h1')).toEqual(PAYMENTS);
    expect(paymentRepo.listForHousehold).toHaveBeenCalledWith('h1', undefined);
  });

  it('a REMOVED parent still sees the whole household', async () => {
    const { svc, paymentRepo } = makeService(
      membership('parent', 'parent-1', 'removed')
    );

    expect(await svc.listForHousehold('parent-1', 'h1')).toEqual(PAYMENTS);
    expect(paymentRepo.listForHousehold).toHaveBeenCalledWith('h1', undefined);
  });

  it('a REMOVED owner still sees the whole household', async () => {
    const { svc, paymentRepo } = makeService(
      membership('owner', 'owner-1', 'removed')
    );

    expect(await svc.listForHousehold('owner-1', 'h1')).toEqual(PAYMENTS);
    expect(paymentRepo.listForHousehold).toHaveBeenCalledWith('h1', undefined);
  });

  it('the membership lookup is status-blind — findMembershipAnyStatus, never findActiveMembership', async () => {
    const { svc, memberRepo } = makeService(membership('parent', 'parent-1'));

    await svc.listForHousehold('parent-1', 'h1');

    expect(memberRepo.findMembershipAnyStatus).toHaveBeenCalledWith(
      'h1',
      'parent-1'
    );
  });
});

describe('PaymentQueryService.listForHousehold — carer scope', () => {
  it('an active nanny sees ONLY her own rows', async () => {
    const { svc, paymentRepo } = makeService(membership('nanny', 'carer-1'));

    expect(await svc.listForHousehold('carer-1', 'h1')).toEqual(PAYMENTS);
    expect(paymentRepo.listForHousehold).toHaveBeenCalledWith('h1', 'carer-1');
  });

  it('a REMOVED nanny still sees her own rows — payroll is an audit trail', async () => {
    const { svc, paymentRepo } = makeService(
      membership('nanny', 'carer-1', 'removed')
    );

    expect(await svc.listForHousehold('carer-1', 'h1')).toEqual(PAYMENTS);
    expect(paymentRepo.listForHousehold).toHaveBeenCalledWith('h1', 'carer-1');
  });

  it('a carer cannot widen her scope — a client-supplied carerId is overridden by her own id', async () => {
    const { svc, paymentRepo } = makeService(membership('nanny', 'carer-1'));

    await svc.listForHousehold('carer-1', 'h1', 'carer-2');

    expect(paymentRepo.listForHousehold).toHaveBeenCalledWith('h1', 'carer-1');
  });
});

describe('PaymentQueryService.listForHousehold — denials', () => {
  it('an active helper is denied, and the repo is never reached', async () => {
    const { svc, paymentRepo } = makeService(membership('helper', 'helper-1'));

    await expect(svc.listForHousehold('helper-1', 'h1')).rejects.toThrow(
      PaymentNotFoundError
    );
    expect(paymentRepo.listForHousehold).not.toHaveBeenCalled();
  });

  it('a REMOVED helper is denied, and the repo is never reached', async () => {
    const { svc, paymentRepo } = makeService(
      membership('helper', 'helper-1', 'removed')
    );

    await expect(svc.listForHousehold('helper-1', 'h1')).rejects.toThrow(
      PaymentNotFoundError
    );
    expect(paymentRepo.listForHousehold).not.toHaveBeenCalled();
  });

  it('a non-member is denied with the SAME error, and the repo is never reached', async () => {
    const { svc, paymentRepo } = makeService(null);

    await expect(svc.listForHousehold('stranger-1', 'h1')).rejects.toThrow(
      PaymentNotFoundError
    );
    expect(paymentRepo.listForHousehold).not.toHaveBeenCalled();
  });

  it('the denial is a 404, never a 403 — existence must not leak', async () => {
    const { svc } = makeService(null);

    const error = await svc
      .listForHousehold('stranger-1', 'h1')
      .catch((e: unknown) => e);

    expect((error as { statusCode: number }).statusCode).toBe(404);
  });
});
