/**
 * @module tests/unit/domains/pay/controllers/reimbursementSettlementController
 *
 * HTTP shaping only — the service is mocked out entirely, so nothing here
 * proves an authorization decision (those live in
 * `reimbursementSettlementService.test.ts`). Same shape as
 * `expenseController.test.ts`.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let ReimbursementSettlementController: any;
let listForWeek: any;
let create: any;

beforeAll(async () => {
  listForWeek = mock(async () => [{ id: 'set-1' }]);
  create = mock(async () => ({ id: 'set-new', amount_minor: 14_600 }));

  mock.module(
    '../../../../../src/domains/pay/services/reimbursementSettlementService',
    () => ({
      reimbursementSettlementService: { listForWeek, create },
    })
  );

  ReimbursementSettlementController = (
    await import(
      '../../../../../src/domains/pay/controllers/reimbursementSettlementController'
    )
  ).ReimbursementSettlementController;
});

function mockRes(): any {
  const res: any = { locals: { requestId: 'req-1' }, req: { path: '/x' } };
  res.status = mock((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = mock((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

beforeEach(() => {
  listForWeek.mockClear();
  create.mockClear();
});

describe('ReimbursementSettlementController.list', () => {
  it('defaults to the household-local week when no weekStart is given', async () => {
    const res = mockRes();
    await ReimbursementSettlementController.list(
      {
        user: { id: 'parent-1' },
        params: { householdId: 'h1' },
        validatedQuery: {},
      } as any,
      res,
      mock()
    );

    expect(listForWeek).toHaveBeenCalledWith('parent-1', 'h1', undefined);
    expect(res.body.data).toEqual({ settlements: [{ id: 'set-1' }] });
  });

  it('passes an explicit weekStart through', async () => {
    const res = mockRes();
    await ReimbursementSettlementController.list(
      {
        user: { id: 'parent-1' },
        params: { householdId: 'h1' },
        validatedQuery: { weekStart: '2026-08-03' },
      } as any,
      res,
      mock()
    );

    expect(listForWeek).toHaveBeenCalledWith('parent-1', 'h1', '2026-08-03');
  });

  it('forwards a service rejection to next(), never a 200', async () => {
    listForWeek.mockImplementationOnce(async () => {
      throw new Error('denied');
    });
    const next = mock();
    const res = mockRes();

    await ReimbursementSettlementController.list(
      {
        user: { id: 'helper-1' },
        params: { householdId: 'h1' },
        validatedQuery: {},
      } as any,
      res,
      next
    );

    expect(next).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('ReimbursementSettlementController.create', () => {
  it('answers 201 with the { settlement } envelope', async () => {
    const res = mockRes();
    const body = {
      carer_id: 'carer-1',
      week_start: '2026-08-03',
      settled_at: '2026-08-10',
    };

    await ReimbursementSettlementController.create(
      {
        user: { id: 'parent-1' },
        params: { householdId: 'h1' },
        body,
      } as any,
      res,
      mock()
    );

    expect(create).toHaveBeenCalledWith('parent-1', 'h1', body);
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toEqual({
      settlement: { id: 'set-new', amount_minor: 14_600 },
    });
  });

  it('forwards a refusal to next()', async () => {
    create.mockImplementationOnce(async () => {
      throw new Error('nothing to settle');
    });
    const next = mock();
    const res = mockRes();

    await ReimbursementSettlementController.create(
      {
        user: { id: 'parent-1' },
        params: { householdId: 'h1' },
        body: {},
      } as any,
      res,
      next
    );

    expect(next).toHaveBeenCalled();
  });
});
