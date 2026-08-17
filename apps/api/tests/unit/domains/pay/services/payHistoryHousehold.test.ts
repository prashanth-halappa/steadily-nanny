/**
 * @module tests/unit/domains/pay/services/payHistoryHousehold
 *
 * HOUSEHOLD-SCOPED PAY HISTORY — the reads a DEPARTED carer's record needs
 * (033/058).
 *
 * Both existing reads take a required `carerId` and hard-filter on it
 * (`payArrangementRepository.listForCarer`,
 * `ptoLedgerRepository.listForCarerYear`), and every route that reaches them
 * puts that id in the URL. The moment 033 NULLs `carer_id`, a carer's pay
 * terms and PTO ledger become unreachable through the API — while still
 * sitting in the tables, still being the thing a back-pay dispute is settled
 * against. These two methods are the address they were missing.
 *
 * GATING: parents/owner only, any membership status. A nanny must not read
 * another carer's rate or leave balance, and the carer-nested endpoints
 * already serve her own — so widening the scope does not widen the audience.
 * Every denial is the domain's existing opaque 404.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

let PayArrangementQueryService: any;
let PtoQueryService: any;
let PayArrangementNotFoundError: any;
let PtoNotFoundError: any;

beforeAll(async () => {
  PayArrangementQueryService = (
    await import(
      '../../../../../src/domains/pay/services/payArrangementQueryService'
    )
  ).PayArrangementQueryService;
  PtoQueryService = (
    await import('../../../../../src/domains/pay/services/ptoQueryService')
  ).PtoQueryService;
  const errors = await import(
    '../../../../../src/domains/pay/errors/payErrors'
  );
  PayArrangementNotFoundError = errors.PayArrangementNotFoundError;
  PtoNotFoundError = errors.PtoNotFoundError;
});

const PARENT = {
  id: 'm1',
  household_id: 'h1',
  user_id: 'parent-1',
  role: 'parent',
  status: 'active',
};

const LIVE_TERMS = {
  id: 'pa-1',
  household_id: 'h1',
  carer_id: 'carer-1',
  household_member_id: 'hm-1',
  carer_display_name: 'Marisol Reyes',
  rate_minor: 1_500,
  currency: 'GBP',
  valid_from: '2026-01-01',
};
/** Her account is gone; 058's stamp and the name snapshot are all that is left. */
const DEPARTED_TERMS = {
  ...LIVE_TERMS,
  id: 'pa-2',
  carer_id: null,
  household_member_id: 'hm-2',
  carer_display_name: 'Emma Clarke',
  valid_from: '2026-03-01',
};

const DEPARTED_LEDGER_ROW = {
  id: 'pl-2',
  household_id: 'h1',
  carer_id: null,
  household_member_id: 'hm-2',
  carer_display_name: 'Emma Clarke',
  kind: 'usage',
  minutes: -480,
  effective_date: '2026-05-04',
  time_off_id: 'to-1',
  note: null,
  created_by: 'parent-1',
  created_at: '2026-05-04T09:00:00.000Z',
};

function payService(membership: unknown = PARENT, rows: unknown[] = []) {
  const payRepo = {
    listForHousehold: mock(async () => rows),
    listForCarer: mock(async () => []),
    effectiveOn: mock(async () => null),
  };
  const svc = new PayArrangementQueryService(
    payRepo as any,
    { findMembershipAnyStatus: mock(async () => membership) } as any,
    { findById: mock(async () => ({ id: 'h1', timezone: 'UTC' })) } as any
  );
  return { svc, payRepo };
}

function ptoService(membership: unknown = PARENT, rows: unknown[] = []) {
  const ptoRepo = {
    listForHouseholdYear: mock(async () => rows),
    listForCarerYear: mock(async () => []),
    create: mock(async () => ({})),
  };
  const svc = new PtoQueryService(
    ptoRepo as any,
    { effectiveOn: mock(async () => null) } as any,
    { findMembershipAnyStatus: mock(async () => membership) } as any,
    { findById: mock(async () => ({ id: 'h1', timezone: 'UTC' })) } as any
  );
  return { svc, ptoRepo };
}

describe('PayArrangementQueryService.getHouseholdHistory', () => {
  it('returns every carer’s terms, departed carers included', async () => {
    const { svc } = payService(PARENT, [DEPARTED_TERMS, LIVE_TERMS]);

    const rows = await svc.getHouseholdHistory('parent-1', 'h1');

    expect(rows.map((r: any) => r.id)).toEqual(['pa-2', 'pa-1']);
    expect(rows[0].carer_display_name).toBe('Emma Clarke');
    expect(rows[0].household_member_id).toBe('hm-2');
  });

  it('reads the household-scoped repository method, not the carer one', async () => {
    const { svc, payRepo } = payService(PARENT, [LIVE_TERMS]);

    await svc.getHouseholdHistory('parent-1', 'h1');

    expect(payRepo.listForHousehold).toHaveBeenCalledWith('h1');
    expect(payRepo.listForCarer).not.toHaveBeenCalled();
  });

  it('a REMOVED parent keeps the read — payroll is an audit trail', async () => {
    const { svc } = payService({ ...PARENT, status: 'removed' }, [LIVE_TERMS]);

    expect(await svc.getHouseholdHistory('parent-1', 'h1')).toHaveLength(1);
  });

  it('denies a nanny — she must not read another carer’s rate', async () => {
    const { svc, payRepo } = payService(
      { ...PARENT, role: 'nanny', user_id: 'carer-1' },
      [LIVE_TERMS]
    );

    await expect(
      svc.getHouseholdHistory('carer-1', 'h1')
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
    expect(payRepo.listForHousehold).not.toHaveBeenCalled();
  });

  it('denies a helper', async () => {
    const { svc } = payService({ ...PARENT, role: 'helper' });

    await expect(
      svc.getHouseholdHistory('helper-1', 'h1')
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });

  it('denies a non-member with the same opaque 404', async () => {
    const { svc } = payService(null);

    await expect(
      svc.getHouseholdHistory('stranger', 'h1')
    ).rejects.toBeInstanceOf(PayArrangementNotFoundError);
  });
});

describe('PtoQueryService.householdLedger', () => {
  it('returns every carer’s ledger rows for the year, departed carers included', async () => {
    const { svc } = ptoService(PARENT, [DEPARTED_LEDGER_ROW]);

    const rows = await svc.householdLedger('parent-1', 'h1', 2026);

    expect(rows).toEqual([DEPARTED_LEDGER_ROW]);
  });

  it('reads the household-scoped repository method, not the carer one', async () => {
    const { svc, ptoRepo } = ptoService(PARENT, []);

    await svc.householdLedger('parent-1', 'h1', 2026);

    expect(ptoRepo.listForHouseholdYear).toHaveBeenCalledWith('h1', 2026);
    expect(ptoRepo.listForCarerYear).not.toHaveBeenCalled();
  });

  it('NEVER performs the lazy annual grant — this read is a read', async () => {
    const { svc, ptoRepo } = ptoService(PARENT, []);

    await svc.householdLedger('parent-1', 'h1', 2026);

    expect(ptoRepo.create).not.toHaveBeenCalled();
  });

  it('denies a nanny — she must not read another carer’s leave', async () => {
    const { svc, ptoRepo } = ptoService({
      ...PARENT,
      role: 'nanny',
      user_id: 'carer-1',
    });

    await expect(
      svc.householdLedger('carer-1', 'h1', 2026)
    ).rejects.toBeInstanceOf(PtoNotFoundError);
    expect(ptoRepo.listForHouseholdYear).not.toHaveBeenCalled();
  });

  it('denies a helper', async () => {
    const { svc } = ptoService({ ...PARENT, role: 'helper' });

    await expect(
      svc.householdLedger('helper-1', 'h1', 2026)
    ).rejects.toBeInstanceOf(PtoNotFoundError);
  });

  it('denies a non-member with the same opaque 404', async () => {
    const { svc } = ptoService(null);

    await expect(
      svc.householdLedger('stranger', 'h1', 2026)
    ).rejects.toBeInstanceOf(PtoNotFoundError);
  });
});
