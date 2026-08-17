import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let PayArrangementController: any;
let getCurrent: any;
let getHistory: any;
let create: any;
let cancelScheduled: any;

beforeAll(async () => {
  getCurrent = mock(async () => ({ id: 'pa-1', rate_minor: 1500 }));
  getHistory = mock(async () => [{ id: 'pa-1' }, { id: 'pa-0' }]);
  create = mock(async () => ({ id: 'pa-new', rate_minor: 1500 }));
  cancelScheduled = mock(async () => ({ id: 'pa-reverted', rate_minor: 1500 }));

  mock.module(
    '../../../../../src/domains/pay/services/payArrangementQueryService',
    () => ({
      payArrangementQueryService: { getCurrent, getHistory },
    })
  );
  mock.module(
    '../../../../../src/domains/pay/services/payArrangementCommandService',
    () => ({
      payArrangementCommandService: { create, cancelScheduled },
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
  for (const m of [getCurrent, getHistory, create, cancelScheduled]) {
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
    // D-6/§10: the controller attaches the server-computed weekly-equivalent
    // at the wire edge — null here because the stub carries no
    // `guaranteed_minutes_per_week` (no guarantee, no line, T16).
    expect(res.body.data).toEqual({
      pay_arrangement: {
        id: 'pa-1',
        rate_minor: 1500,
        weekly_equivalent_minor: null,
      },
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
      pay_arrangements: [
        { id: 'pa-1', weekly_equivalent_minor: null },
        { id: 'pa-0', weekly_equivalent_minor: null },
      ],
    });
  });

  // P1: the direct write path is deleted. `pay_arrangements` is minted in
  // exactly one place (`termsProposalCommandService.accept`), so an
  // arrangement existing and someone having tapped Agree are one fact. A
  // controller method here would be a second door standing open.
  it('has no create handler at all', () => {
    expect(PayArrangementController.create).toBeUndefined();
  });

  it('the command service is never reachable through this controller for a create', async () => {
    const res = mockRes();
    await PayArrangementController.cancelScheduled(
      {
        user: { id: 'parent-1' },
        params: {
          householdId: 'h1',
          carerId: 'carer-1',
          arrangementId: 'pa-scheduled',
        },
      } as any,
      res,
      mock()
    );
    expect(create).not.toHaveBeenCalled();
    expect(cancelScheduled).toHaveBeenCalledWith(
      'parent-1',
      'h1',
      'carer-1',
      'pa-scheduled'
    );
  });

  it('forwards service errors to next() rather than answering', async () => {
    cancelScheduled.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = mockRes();
    const next = mock();
    await PayArrangementController.cancelScheduled(
      {
        user: { id: 'parent-1' },
        params: {
          householdId: 'h1',
          carerId: 'carer-1',
          arrangementId: 'pa-scheduled',
        },
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

  it('cancelScheduled passes the caller and every route id through', async () => {
    const res = mockRes();
    await PayArrangementController.cancelScheduled(
      {
        user: { id: 'parent-1' },
        params: {
          householdId: 'h1',
          carerId: 'carer-1',
          arrangementId: 'pa-scheduled',
        },
      } as any,
      res,
      mock()
    );
    expect(cancelScheduled).toHaveBeenCalledWith(
      'parent-1',
      'h1',
      'carer-1',
      'pa-scheduled'
    );
    expect(res.body.data).toEqual({
      pay_arrangement: { id: 'pa-reverted', rate_minor: 1500 },
    });
  });
});
