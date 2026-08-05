/**
 * @module api/endpoints/__tests__/expenses.test
 * Covers: URL construction (week + pending list filters, singular-envelope
 * unwrap for create/update/review, void on withdraw), request validation via
 * the shared discriminated-union schema — including that a MILEAGE payload
 * carrying `amount_minor` is rejected client-side without ever calling the
 * API (docs/11-MONEY.md §6/§8/§9, expense.schema.ts's `.strict()` variants).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let expenseApi: any;
let apiClient: any;

const now = '2026-08-01T00:00:00.000Z';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const EXPENSE_ID = '66666666-6666-4666-8666-666666666666';
const CARER_ID = '33333333-3333-4333-8333-333333333333';

const validExpense = {
  id: EXPENSE_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  local_date: '2026-08-03',
  kind: 'expense',
  description: 'Soft play tickets',
  amount_minor: 1200,
  miles: null,
  currency: 'GBP',
  status: 'pending',
  reviewed_by: null,
  reviewed_at: null,
  review_note: null,
  carer_display_name: 'Amara',
  created_at: now,
  updated_at: now,
};

beforeAll(async () => {
  mock.module('@/src/api/client', () => ({
    apiClient: {
      get: mock(() => Promise.resolve({})),
      post: mock(() => Promise.resolve({})),
      put: mock(() => Promise.resolve({})),
      patch: mock(() => Promise.resolve({})),
      delete: mock(() => Promise.resolve({})),
    },
  }));

  const mod = await import('../expenses');
  expenseApi = mod.expenseApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
  apiClient.patch.mockReset?.();
  apiClient.delete.mockReset?.();
});

describe('expenseApi.listForWeek', () => {
  it('GETs the household route with a week_start query param', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { expenses: [validExpense] } },
    });

    const result = await expenseApi.listForWeek(HOUSEHOLD_ID, '2026-08-03');

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/expenses`,
      { params: { week_start: '2026-08-03' } }
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(EXPENSE_ID);
  });
});

describe('expenseApi.listPending', () => {
  it('GETs the household route with status=pending', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { expenses: [validExpense] } },
    });

    const result = await expenseApi.listPending(HOUSEHOLD_ID);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/expenses`,
      { params: { status: 'pending' } }
    );
    expect(result).toHaveLength(1);
  });
});

describe('expenseApi.create', () => {
  it('POSTs a valid expense-kind body and returns the created row', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { expense: validExpense } },
    });

    const result = await expenseApi.create(HOUSEHOLD_ID, {
      kind: 'expense',
      local_date: '2026-08-03',
      description: 'Soft play tickets',
      amount_minor: 1200,
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/expenses`,
      expect.objectContaining({
        kind: 'expense',
        amount_minor: 1200,
        currency: 'GBP',
      })
    );
    expect(result.id).toBe(EXPENSE_ID);
  });

  it('POSTs a valid mileage-kind body without amount_minor', async () => {
    apiClient.post.mockResolvedValue({
      data: {
        data: {
          expense: {
            ...validExpense,
            kind: 'mileage',
            amount_minor: null,
            miles: 12.4,
          },
        },
      },
    });

    await expenseApi.create(HOUSEHOLD_ID, {
      kind: 'mileage',
      local_date: '2026-08-03',
      description: 'Nursery run',
      miles: 12.4,
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/expenses`,
      expect.objectContaining({ kind: 'mileage', miles: 12.4 })
    );
  });

  it('rejects a mileage payload that also carries amount_minor, without calling the API', async () => {
    await expect(
      expenseApi.create(HOUSEHOLD_ID, {
        kind: 'mileage',
        local_date: '2026-08-03',
        description: 'Nursery run',
        miles: 12.4,
        // A mileage payload must never carry its own amount — the wire
        // schema's `.strict()` variant rejects this as an unrecognized key.
        amount_minor: 500,
      } as never)
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('rejects an expense-kind payload missing amount_minor', async () => {
    await expect(
      expenseApi.create(HOUSEHOLD_ID, {
        kind: 'expense',
        local_date: '2026-08-03',
        description: 'Soft play tickets',
      } as never)
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('expenseApi.update', () => {
  it('PATCHes the expense route and returns the updated row', async () => {
    apiClient.patch.mockResolvedValue({
      data: { data: { expense: { ...validExpense, description: 'Updated' } } },
    });

    const result = await expenseApi.update(EXPENSE_ID, {
      kind: 'expense',
      local_date: '2026-08-03',
      description: 'Updated',
      amount_minor: 1500,
    });

    expect(apiClient.patch).toHaveBeenCalledWith(
      `/v1/expenses/${EXPENSE_ID}`,
      expect.objectContaining({ description: 'Updated' })
    );
    expect(result.description).toBe('Updated');
  });
});

describe('expenseApi.withdraw', () => {
  it('DELETEs the expense route', async () => {
    apiClient.delete.mockResolvedValue({});

    await expenseApi.withdraw(EXPENSE_ID);

    expect(apiClient.delete).toHaveBeenCalledWith(`/v1/expenses/${EXPENSE_ID}`);
  });
});

describe('expenseApi.review', () => {
  it('POSTs the review route with the approved status', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { expense: { ...validExpense, status: 'approved' } } },
    });

    const result = await expenseApi.review(EXPENSE_ID, {
      status: 'approved',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/expenses/${EXPENSE_ID}/review`,
      { status: 'approved' }
    );
    expect(result.status).toBe('approved');
  });

  it('POSTs the review route with a rejection note', async () => {
    apiClient.post.mockResolvedValue({
      data: {
        data: {
          expense: {
            ...validExpense,
            status: 'rejected',
            review_note: 'Already paid in cash',
          },
        },
      },
    });

    const result = await expenseApi.review(EXPENSE_ID, {
      status: 'rejected',
      review_note: 'Already paid in cash',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/expenses/${EXPENSE_ID}/review`,
      { status: 'rejected', review_note: 'Already paid in cash' }
    );
    expect(result.review_note).toBe('Already paid in cash');
  });
});
