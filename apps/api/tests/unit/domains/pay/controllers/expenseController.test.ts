import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let ExpenseController: any;
let listForWeek: any;
let listPending: any;
let create: any;
let update: any;
let withdraw: any;
let review: any;

beforeAll(async () => {
  listForWeek = mock(async () => [{ id: 'exp-1' }, { id: 'exp-0' }]);
  listPending = mock(async () => [{ id: 'exp-pending' }]);
  create = mock(async () => ({ id: 'exp-new', status: 'pending' }));
  update = mock(async () => ({ id: 'exp-1', description: 'updated' }));
  withdraw = mock(async () => undefined);
  review = mock(async () => ({ id: 'exp-1', status: 'approved' }));

  mock.module(
    '../../../../../src/domains/pay/services/expenseQueryService',
    () => ({
      expenseQueryService: { listForWeek, listPending },
    })
  );
  mock.module(
    '../../../../../src/domains/pay/services/expenseCommandService',
    () => ({
      expenseCommandService: { create, update, withdraw, review },
    })
  );

  ExpenseController = (
    await import('../../../../../src/domains/pay/controllers/expenseController')
  ).ExpenseController;
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
  for (const m of [
    listForWeek,
    listPending,
    create,
    update,
    withdraw,
    review,
  ]) {
    m.mockClear?.();
  }
});

describe('ExpenseController.list', () => {
  it('lists the household-local week by default', async () => {
    const res = mockRes();
    await ExpenseController.list(
      {
        user: { id: 'parent-1' },
        params: { householdId: 'h1' },
        validatedQuery: {},
      } as any,
      res,
      mock()
    );
    expect(listForWeek).toHaveBeenCalledWith('parent-1', 'h1', undefined);
    expect(res.body.data).toEqual({
      expenses: [{ id: 'exp-1' }, { id: 'exp-0' }],
    });
  });

  it('passes an explicit week_start query param through', async () => {
    const res = mockRes();
    await ExpenseController.list(
      {
        user: { id: 'parent-1' },
        params: { householdId: 'h1' },
        validatedQuery: { week_start: '2026-08-03' },
      } as any,
      res,
      mock()
    );
    expect(listForWeek).toHaveBeenCalledWith('parent-1', 'h1', '2026-08-03');
  });

  it('routes to listPending when status=pending is requested', async () => {
    const res = mockRes();
    await ExpenseController.list(
      {
        user: { id: 'parent-1' },
        params: { householdId: 'h1' },
        validatedQuery: { status: 'pending' },
      } as any,
      res,
      mock()
    );
    expect(listPending).toHaveBeenCalledWith('parent-1', 'h1');
    expect(listForWeek).not.toHaveBeenCalled();
    expect(res.body.data).toEqual({ expenses: [{ id: 'exp-pending' }] });
  });

  it('forwards read errors to next() rather than answering', async () => {
    listForWeek.mockImplementationOnce(async () => {
      throw new Error('denied');
    });
    const res = mockRes();
    const next = mock();
    await ExpenseController.list(
      {
        user: { id: 'helper-1' },
        params: { householdId: 'h1' },
        validatedQuery: {},
      } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
    expect(res.body).toBeUndefined();
  });
});

describe('ExpenseController.create', () => {
  it('responds 201 with the created claim', async () => {
    const res = mockRes();
    const body = {
      kind: 'expense',
      local_date: '2026-08-04',
      description: 'Nappies',
      amount_minor: 1200,
      currency: 'GBP',
    };
    await ExpenseController.create(
      { user: { id: 'carer-1' }, params: { householdId: 'h1' }, body } as any,
      res,
      mock()
    );
    expect(create).toHaveBeenCalledWith('carer-1', 'h1', body);
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toEqual({
      expense: { id: 'exp-new', status: 'pending' },
    });
  });

  it('forwards service errors to next()', async () => {
    create.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const res = mockRes();
    const next = mock();
    await ExpenseController.create(
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

describe('ExpenseController.update', () => {
  it('passes the caller, expenseId, and body through', async () => {
    const res = mockRes();
    const body = {
      kind: 'expense',
      local_date: '2026-08-04',
      description: 'x',
      amount_minor: 500,
      currency: 'GBP',
    };
    await ExpenseController.update(
      { user: { id: 'carer-1' }, params: { expenseId: 'exp-1' }, body } as any,
      res,
      mock()
    );
    expect(update).toHaveBeenCalledWith('carer-1', 'exp-1', body);
    expect(res.body.data).toEqual({
      expense: { id: 'exp-1', description: 'updated' },
    });
  });
});

describe('ExpenseController.withdraw', () => {
  it('withdraws and responds with no content-bearing body', async () => {
    const res = mockRes();
    await ExpenseController.withdraw(
      { user: { id: 'carer-1' }, params: { expenseId: 'exp-1' } } as any,
      res,
      mock()
    );
    expect(withdraw).toHaveBeenCalledWith('carer-1', 'exp-1');
    expect(res.statusCode).toBe(200);
  });

  it('forwards errors to next()', async () => {
    withdraw.mockImplementationOnce(async () => {
      throw new Error('not editable');
    });
    const res = mockRes();
    const next = mock();
    await ExpenseController.withdraw(
      { user: { id: 'carer-1' }, params: { expenseId: 'exp-1' } } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
  });
});

describe('ExpenseController.review', () => {
  it('passes the caller, expenseId, and review body through', async () => {
    const res = mockRes();
    const body = { status: 'approved', review_note: 'Looks right' };
    await ExpenseController.review(
      { user: { id: 'parent-1' }, params: { expenseId: 'exp-1' }, body } as any,
      res,
      mock()
    );
    expect(review).toHaveBeenCalledWith('parent-1', 'exp-1', body);
    expect(res.body.data).toEqual({
      expense: { id: 'exp-1', status: 'approved' },
    });
  });

  it('forwards a carer’s review attempt as an error, not a 200', async () => {
    review.mockImplementationOnce(async () => {
      throw new Error('not a parent');
    });
    const res = mockRes();
    const next = mock();
    await ExpenseController.review(
      {
        user: { id: 'carer-1' },
        params: { expenseId: 'exp-1' },
        body: { status: 'approved' },
      } as any,
      res,
      next
    );
    expect(next).toHaveBeenCalled();
    expect(res.body).toBeUndefined();
  });
});
