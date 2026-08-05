import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let PtoController: any;
let balance: any;
let ledger: any;
let markTimeOffPaid: any;

beforeAll(async () => {
  balance = mock(async () => ({
    carer_id: 'carer-1',
    household_id: 'h1',
    year: 2026,
    entitlement_minutes: 16800,
    accrued_minutes: 16800,
    used_minutes: 480,
    balance_minutes: 16320,
  }));
  ledger = mock(async () => [{ id: 'ptl-1' }, { id: 'ptl-2' }]);
  markTimeOffPaid = mock(async () => ({ id: 'ptl-new', minutes: -480 }));

  mock.module(
    '../../../../../src/domains/pay/services/ptoQueryService',
    () => ({
      ptoQueryService: { balance, ledger },
    })
  );
  mock.module(
    '../../../../../src/domains/pay/services/ptoCommandService',
    () => ({
      ptoCommandService: { markTimeOffPaid },
    })
  );

  PtoController = (
    await import('../../../../../src/domains/pay/controllers/ptoController')
  ).PtoController;
});

function mockRes(): any {
  const res: any = { locals: { requestId: 'req-1' }, req: { path: '/x' } };
  res.status = mock((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = mock((body: any) => {
    res.body = body;
    return res;
  });
  return res;
}

beforeEach(() => {
  for (const m of [balance, ledger, markTimeOffPaid]) {
    m.mockClear?.();
  }
});

describe('PtoController.balance', () => {
  it('passes the caller, both route ids and the validated year through', async () => {
    const res = mockRes();
    await PtoController.balance(
      {
        user: { id: 'parent-1' },
        params: { householdId: 'h1', carerId: 'carer-1' },
        validatedQuery: { year: 2026 },
      } as any,
      res,
      mock()
    );
    expect(balance).toHaveBeenCalledWith('parent-1', 'h1', 'carer-1', 2026);
    expect(res.body.data).toEqual({
      pto_balance: {
        carer_id: 'carer-1',
        household_id: 'h1',
        year: 2026,
        entitlement_minutes: 16800,
        accrued_minutes: 16800,
        used_minutes: 480,
        balance_minutes: 16320,
      },
    });
  });

  it('forwards read errors to next() rather than answering (a helper denial must not 200)', async () => {
    balance.mockImplementationOnce(async () => {
      throw new Error('denied');
    });
    const res = mockRes();
    const next = mock();
    await PtoController.balance(
      {
        user: { id: 'helper-1' },
        params: { householdId: 'h1', carerId: 'carer-1' },
        validatedQuery: { year: 2026 },
      } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
    expect(res.body).toBeUndefined();
  });
});

describe('PtoController.ledger', () => {
  it('responds with the ledger entries under pto_ledger_entries', async () => {
    const res = mockRes();
    await PtoController.ledger(
      {
        user: { id: 'carer-1' },
        params: { householdId: 'h1', carerId: 'carer-1' },
        validatedQuery: { year: 2026 },
      } as any,
      res,
      mock()
    );
    expect(ledger).toHaveBeenCalledWith('carer-1', 'h1', 'carer-1', 2026);
    expect(res.body.data).toEqual({
      pto_ledger_entries: [{ id: 'ptl-1' }, { id: 'ptl-2' }],
    });
  });

  it('forwards errors to next()', async () => {
    ledger.mockImplementationOnce(async () => {
      throw new Error('denied');
    });
    const res = mockRes();
    const next = mock();
    await PtoController.ledger(
      {
        user: { id: 'helper-1' },
        params: { householdId: 'h1', carerId: 'carer-1' },
        validatedQuery: { year: 2026 },
      } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
    expect(res.body).toBeUndefined();
  });
});

describe('PtoController.markPaid', () => {
  it('responds 201 with the created ledger entry, passing the caller + householdId + body through', async () => {
    const res = mockRes();
    const body = { time_off_id: 'to-1', minutes: 480 };
    await PtoController.markPaid(
      {
        user: { id: 'parent-1' },
        params: { householdId: 'h1' },
        body,
      } as any,
      res,
      mock()
    );
    expect(markTimeOffPaid).toHaveBeenCalledWith('parent-1', 'h1', body);
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toEqual({
      pto_ledger_entry: { id: 'ptl-new', minutes: -480 },
    });
  });

  it('forwards write errors to next() rather than answering', async () => {
    markTimeOffPaid.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = mockRes();
    const next = mock();
    await PtoController.markPaid(
      {
        user: { id: 'parent-1' },
        params: { householdId: 'h1' },
        body: {},
      } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
    expect(res.body).toBeUndefined();
  });
});
