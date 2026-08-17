/**
 * @module api/endpoints/__tests__/reimbursementSettlements.test
 * Covers: URL + `weekStart` query param on the list, the singular-envelope
 * unwrap on create, and that a body carrying an AMOUNT is rejected
 * client-side without ever reaching the API — the server computes the figure
 * from the approved expense rows, so a client-supplied one is a spoof
 * (reimbursementSettlement.schema.ts).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let reimbursementSettlementApi: any;
let apiClient: any;

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CARER_ID = '33333333-3333-4333-8333-333333333333';
/** A `household_members.id` (058) — deliberately different from the carer's. */
const MEMBER_ID = '44444444-4444-4444-8444-444444444444';
const SETTLEMENT_ID = '77777777-7777-4777-8777-777777777777';
const WEEK_START = '2026-08-17';

const validSettlement = {
  id: SETTLEMENT_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  week_start: WEEK_START,
  amount_minor: 3480,
  currency: 'GBP',
  settled_at: '2026-08-18',
  note: 'Cash on Friday',
  recorded_by: '44444444-4444-4444-8444-444444444444',
  created_at: '2026-08-18T00:00:00.000Z',
};

beforeAll(async () => {
  mock.module('@/src/api/client', () => ({
    apiClient: {
      get: mock(() => Promise.resolve({})),
      post: mock(() => Promise.resolve({})),
      patch: mock(() => Promise.resolve({})),
      delete: mock(() => Promise.resolve({})),
    },
  }));

  const mod = await import('../reimbursementSettlements');
  reimbursementSettlementApi = mod.reimbursementSettlementApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
});

describe('reimbursementSettlementApi.listForWeek', () => {
  it('GETs the household route with a weekStart query param', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { settlements: [validSettlement] } },
    });

    const result = await reimbursementSettlementApi.listForWeek(
      HOUSEHOLD_ID,
      WEEK_START
    );

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/reimbursement-settlements`,
      { params: { weekStart: WEEK_START } }
    );
    expect(result).toHaveLength(1);
    expect(result[0].amount_minor).toBe(3480);
  });

  it('rejects a response whose settlement is malformed', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: { settlements: [{ ...validSettlement, amount_minor: 12.5 }] },
      },
    });

    await expect(
      reimbursementSettlementApi.listForWeek(HOUSEHOLD_ID, WEEK_START)
    ).rejects.toThrow();
  });
});

describe('reimbursementSettlementApi.create', () => {
  it('POSTs the body and unwraps the singular envelope', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { settlement: validSettlement } },
    });

    const result = await reimbursementSettlementApi.create(HOUSEHOLD_ID, {
      carer_id: CARER_ID,
      week_start: WEEK_START,
      settled_at: '2026-08-18',
      note: 'Cash on Friday',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/reimbursement-settlements`,
      {
        carer_id: CARER_ID,
        week_start: WEEK_START,
        settled_at: '2026-08-18',
        note: 'Cash on Friday',
      }
    );
    expect(result.id).toBe(SETTLEMENT_ID);
  });

  it('never forwards a client-supplied amount — the server computes it', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { settlement: validSettlement } },
    });

    await reimbursementSettlementApi.create(HOUSEHOLD_ID, {
      carer_id: CARER_ID,
      week_start: WEEK_START,
      settled_at: '2026-08-18',
      amount_minor: 999_999,
    } as never);

    const body = apiClient.post.mock.calls[0][1];
    expect(body).not.toHaveProperty('amount_minor');
    expect(body).not.toHaveProperty('currency');
  });

  it('refuses a settled_at that is not a date without calling the API', async () => {
    await expect(
      reimbursementSettlementApi.create(HOUSEHOLD_ID, {
        carer_id: CARER_ID,
        week_start: WEEK_START,
        settled_at: '2026-08-18T09:00:00.000Z',
      })
    ).rejects.toThrow();

    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('reimbursementSettlementApi.listUnsettled', () => {
  it('GETs /unsettled and unwraps the { weeks } envelope', async () => {
    const week = {
      carer_id: CARER_ID,
      // 033/058: the API reports a DEPARTED carer's outstanding week too, so
      // the row carries the membership stamp and the name snapshot alongside
      // a `carer_id` that may be null.
      household_member_id: MEMBER_ID,
      carer_display_name: 'Marisol Reyes',
      week_start: WEEK_START,
      amount_minor: 3480,
      currency: 'GBP',
    };
    apiClient.get.mockResolvedValue({
      data: { data: { weeks: [week] } },
    });

    const result = await reimbursementSettlementApi.listUnsettled(HOUSEHOLD_ID);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/reimbursement-settlements/unsettled`
    );
    expect(result).toEqual([week]);
  });

  it('rejects a response whose week row is malformed', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          weeks: [
            {
              carer_id: CARER_ID,
              week_start: WEEK_START,
              amount_minor: 0,
              currency: 'GBP',
            },
          ],
        },
      },
    });

    await expect(
      reimbursementSettlementApi.listUnsettled(HOUSEHOLD_ID)
    ).rejects.toThrow();
  });
});
