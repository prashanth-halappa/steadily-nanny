/**
 * @module api/endpoints/__tests__/payments.test
 * Covers: URL construction, request validation, response-envelope unwrap +
 * Zod validation for paymentApi.list / create. Wire shapes come from the ONE
 * shared source (`payment.schema`), so a fixture that drifts from the server
 * contract fails here rather than on device.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

// Late-bound after `mock.module` — `any` is permitted in test files by the
// Biome override, unlike production code.
let paymentApi: any;
let apiClient: any;

const now = '2026-08-11T09:30:00.000Z';
const TIMESHEET_ID = '44444444-4444-4444-8444-444444444444';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

const validPayment = {
  id: '66666666-6666-4666-8666-666666666666',
  timesheet_id: TIMESHEET_ID,
  household_id: '22222222-2222-4222-8222-222222222222',
  carer_id: '33333333-3333-4333-8333-333333333333',
  amount_minor: 23612,
  kind: 'payment',
  corrects_payment_id: null,
  correction_reason: null,
  currency: 'GBP',
  paid_at: '2026-08-11',
  method_note: 'Bank transfer',
  recorded_by: '11111111-1111-4111-8111-111111111111',
  created_at: now,
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

  const mod = await import('../payments');
  paymentApi = mod.paymentApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
});

describe('paymentApi.list', () => {
  it('GETs the timesheet-nested payments and returns validated rows', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { payments: [validPayment] } },
    });

    const result = await paymentApi.list(TIMESHEET_ID);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/timesheets/${TIMESHEET_ID}/payments`
    );
    expect(result).toHaveLength(1);
    expect(result[0].amount_minor).toBe(23612);
  });

  it('throws when the payload fails Zod validation', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { payments: [{ ...validPayment, amount_minor: 0 }] } },
    });

    await expect(paymentApi.list(TIMESHEET_ID)).rejects.toBeDefined();
  });
});

describe('paymentApi.listForHousehold', () => {
  it('GETs the household-nested payments and returns validated rows', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { payments: [validPayment] } },
    });

    const result = await paymentApi.listForHousehold(HOUSEHOLD_ID);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/payments`
    );
    expect(result).toHaveLength(1);
    expect(result[0].amount_minor).toBe(23612);
  });

  it('throws when the payload fails Zod validation', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { payments: [{ ...validPayment, amount_minor: 0 }] } },
    });

    await expect(
      paymentApi.listForHousehold(HOUSEHOLD_ID)
    ).rejects.toBeDefined();
  });
});

describe('paymentApi.create', () => {
  it('POSTs the validated body and returns the created payment', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { payment: validPayment } },
    });

    const result = await paymentApi.create(TIMESHEET_ID, {
      amount_minor: 23612,
      paid_at: '2026-08-11',
      method_note: 'Bank transfer',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/timesheets/${TIMESHEET_ID}/payments`,
      {
        amount_minor: 23612,
        paid_at: '2026-08-11',
        method_note: 'Bank transfer',
      }
    );
    expect(result.id).toBe(validPayment.id);
  });

  it('omits method_note entirely when it is not supplied', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { payment: { ...validPayment, method_note: null } } },
    });

    await paymentApi.create(TIMESHEET_ID, {
      amount_minor: 5000,
      paid_at: '2026-08-11',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/timesheets/${TIMESHEET_ID}/payments`,
      { amount_minor: 5000, paid_at: '2026-08-11' }
    );
  });

  it('refuses a zero amount client-side, before any request is sent', async () => {
    await expect(
      paymentApi.create(TIMESHEET_ID, {
        amount_minor: 0,
        paid_at: '2026-08-11',
      })
    ).rejects.toBeDefined();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('paymentApi.correct', () => {
  const PAYMENT_ID = '66666666-6666-4666-8666-666666666666';
  // What the server writes back: the NEGATED row, under `correction`.
  const validCorrection = {
    ...validPayment,
    id: '77777777-7777-4777-8777-777777777777',
    amount_minor: -23612,
    kind: 'correction',
    corrects_payment_id: PAYMENT_ID,
    correction_reason: 'recorded twice',
    method_note: null,
    paid_at: '2026-08-18',
  };

  it('POSTs a POSITIVE magnitude and returns the negated correction', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { correction: validCorrection } },
    });

    const result = await paymentApi.correct(TIMESHEET_ID, PAYMENT_ID, {
      amount_minor: 23612,
      paid_at: '2026-08-18',
      reason: 'recorded twice',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/timesheets/${TIMESHEET_ID}/payments/${PAYMENT_ID}/corrections`,
      { amount_minor: 23612, paid_at: '2026-08-18', reason: 'recorded twice' }
    );
    expect(result.amount_minor).toBe(-23612);
    expect(result.correction_reason).toBe('recorded twice');
  });

  it('refuses an empty reason client-side, before any request is sent', async () => {
    await expect(
      paymentApi.correct(TIMESHEET_ID, PAYMENT_ID, {
        amount_minor: 5000,
        paid_at: '2026-08-18',
        reason: '   ',
      })
    ).rejects.toBeDefined();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('refuses a negative magnitude — the SERVER owns the sign flip', async () => {
    await expect(
      paymentApi.correct(TIMESHEET_ID, PAYMENT_ID, {
        amount_minor: -5000,
        paid_at: '2026-08-18',
        reason: 'recorded twice',
      })
    ).rejects.toBeDefined();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
