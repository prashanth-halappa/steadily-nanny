import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let PayArrangementController: any;
let getCurrent: any;
let getHistory: any;
let create: any;

beforeAll(async () => {
  getCurrent = mock(async () => ({ id: 'pa-1', rate_minor: 1500 }));
  getHistory = mock(async () => [{ id: 'pa-1' }, { id: 'pa-0' }]);
  create = mock(async () => ({ id: 'pa-new', rate_minor: 1500 }));

  mock.module(
    '../../../../../src/domains/pay/services/payArrangementQueryService',
    () => ({
      payArrangementQueryService: { getCurrent, getHistory },
    })
  );
  mock.module(
    '../../../../../src/domains/pay/services/payArrangementCommandService',
    () => ({
      payArrangementCommandService: { create },
    })
  );

  PayArrangementController = (
    await import(
      '../../../../../src/domains/pay/controllers/payArrangementController'
    )
  ).PayArrangementController;
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
  for (const m of [getCurrent, getHistory, create]) {
    m.mockClear?.();
  }
});

describe('PayArrangementController', () => {
  it('getCurrent passes the caller and both route ids through', async () => {
    const res = mockRes();
    await PayArrangementController.getCurrent(
      {
        user: { id: 'parent-1' },
        params: { householdId: 'h1', carerId: 'carer-1' },
      } as any,
      res,
      mock()
    );
    expect(getCurrent).toHaveBeenCalledWith('parent-1', 'h1', 'carer-1');
    expect(res.body.data).toEqual({
      pay_arrangement: { id: 'pa-1', rate_minor: 1500 },
    });
  });

  it('getCurrent responds with null when no arrangement is in effect', async () => {
    getCurrent.mockImplementationOnce(async () => null);
    const res = mockRes();
    await PayArrangementController.getCurrent(
      {
        user: { id: 'parent-1' },
        params: { householdId: 'h1', carerId: 'carer-1' },
      } as any,
      res,
      mock()
    );
    expect(res.body.data).toEqual({ pay_arrangement: null });
  });

  it('list responds with the append-only history', async () => {
    const res = mockRes();
    await PayArrangementController.list(
      {
        user: { id: 'carer-1' },
        params: { householdId: 'h1', carerId: 'carer-1' },
      } as any,
      res,
      mock()
    );
    expect(getHistory).toHaveBeenCalledWith('carer-1', 'h1', 'carer-1');
    expect(res.body.data).toEqual({
      pay_arrangements: [{ id: 'pa-1' }, { id: 'pa-0' }],
    });
  });

  it('create responds 201 with the new arrangement', async () => {
    const res = mockRes();
    const body = {
      rate_minor: 1500,
      currency: 'GBP',
      valid_from: '2026-08-04',
    };
    await PayArrangementController.create(
      {
        user: { id: 'parent-1' },
        params: { householdId: 'h1', carerId: 'carer-1' },
        body,
      } as any,
      res,
      mock()
    );
    expect(create).toHaveBeenCalledWith('parent-1', 'h1', 'carer-1', body);
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toEqual({
      pay_arrangement: { id: 'pa-new', rate_minor: 1500 },
    });
  });

  it('forwards service errors to next() rather than answering', async () => {
    create.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = mockRes();
    const next = mock();
    await PayArrangementController.create(
      {
        user: { id: 'parent-1' },
        params: { householdId: 'h1', carerId: 'carer-1' },
        body: {},
      } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
    expect(res.body).toBeUndefined();
  });

  it('forwards read errors too (a helper denial must not 200)', async () => {
    getHistory.mockImplementationOnce(async () => {
      throw new Error('denied');
    });
    const res = mockRes();
    const next = mock();
    await PayArrangementController.list(
      {
        user: { id: 'helper-1' },
        params: { householdId: 'h1', carerId: 'carer-1' },
      } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
    expect(res.body).toBeUndefined();
  });
});
