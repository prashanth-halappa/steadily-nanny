/**
 * @module api/endpoints/__tests__/payArrangements.test
 * Covers: URL construction, request validation, response-envelope unwrap +
 * Zod validation for payArrangementApi.getCurrent / getHistory / create —
 * including the nullable-`getCurrent` distinction (docs/11-MONEY.md §4: no
 * arrangement is `null`, never coerced to `undefined`, never thrown).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let payArrangementApi: any;
let apiClient: any;

const now = '2026-08-01T00:00:00.000Z';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CARER_ID = '33333333-3333-4333-8333-333333333333';

const validArrangement = {
  id: '44444444-4444-4444-8444-444444444444',
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  rate_minor: 1500,
  bill_rate_minor: null,
  currency: 'GBP',
  overtime_threshold_minutes: 2400,
  overtime_multiplier: 1.5,
  guaranteed_minutes_per_week: null,
  pto_entitlement_minutes_per_year: null,
  mileage_rate_per_mile_minor: null,
  cancellation_paid_within_hours: 24,
  valid_from: '2026-08-01',
  valid_to: null,
  carer_display_name: 'Ines Ferreira',
  note: null,
  created_by: '55555555-5555-4555-8555-555555555555',
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

  const mod = await import('../payArrangements');
  payArrangementApi = mod.payArrangementApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
});

describe('payArrangementApi.getCurrent', () => {
  it('GETs /current and returns the validated arrangement', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { pay_arrangement: validArrangement } },
    });

    const result = await payArrangementApi.getCurrent(HOUSEHOLD_ID, CARER_ID);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/carers/${CARER_ID}/pay-arrangements/current`
    );
    expect(result?.rate_minor).toBe(1500);
  });

  it('returns null (not undefined, not thrown) when no arrangement is set', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { pay_arrangement: null } },
    });

    const result = await payArrangementApi.getCurrent(HOUSEHOLD_ID, CARER_ID);

    expect(result).toBeNull();
  });
});

describe('payArrangementApi.getHistory', () => {
  it('GETs the list route and returns the validated rows', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { pay_arrangements: [validArrangement] } },
    });

    const result = await payArrangementApi.getHistory(HOUSEHOLD_ID, CARER_ID);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/carers/${CARER_ID}/pay-arrangements`
    );
    expect(result).toHaveLength(1);
  });
});

describe('payArrangementApi.create', () => {
  const createInput = {
    rate_minor: 1600,
    currency: 'GBP',
    overtime_multiplier: 1.5,
    valid_from: '2026-08-04',
    valid_to: null,
  };

  it('POSTs the validated body and returns the created arrangement', async () => {
    apiClient.post.mockResolvedValue({
      data: {
        data: { pay_arrangement: { ...validArrangement, rate_minor: 1600 } },
      },
    });

    const result = await payArrangementApi.create(
      HOUSEHOLD_ID,
      CARER_ID,
      createInput
    );

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/carers/${CARER_ID}/pay-arrangements`,
      expect.objectContaining({ rate_minor: 1600, valid_from: '2026-08-04' })
    );
    expect(result.rate_minor).toBe(1600);
  });

  it('rejects an invalid body without calling the API', async () => {
    await expect(
      payArrangementApi.create(HOUSEHOLD_ID, CARER_ID, {
        ...createInput,
        rate_minor: -5,
      })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

// --- D-31/D-45 ack + dissent, D-16 cancel-scheduled -------------------------

const ARRANGEMENT_ID = validArrangement.id;
const ackUrlBase = `/v1/households/${HOUSEHOLD_ID}/carers/${CARER_ID}/pay-arrangements/${ARRANGEMENT_ID}`;
const seenRow = {
  id: '66666666-6666-4666-8666-666666666666',
  arrangement_id: ARRANGEMENT_ID,
  carer_id: CARER_ID,
  kind: 'seen',
  note: null,
  created_at: now,
};

describe('payArrangementApi.ack', () => {
  it('POSTs .../ack with no body and returns the validated row', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { pay_arrangement_ack: seenRow } },
    });

    const result = await payArrangementApi.ack(
      HOUSEHOLD_ID,
      CARER_ID,
      ARRANGEMENT_ID
    );

    expect(apiClient.post).toHaveBeenCalledWith(`${ackUrlBase}/ack`);
    expect(result.kind).toBe('seen');
  });
});

describe('payArrangementApi.dissent', () => {
  it('POSTs .../dissent with the note and returns the validated row', async () => {
    apiClient.post.mockResolvedValue({
      data: {
        data: {
          pay_arrangement_ack: {
            ...seenRow,
            kind: 'disagreed',
            note: 'The new rate is lower.',
          },
        },
      },
    });

    const result = await payArrangementApi.dissent(
      HOUSEHOLD_ID,
      CARER_ID,
      ARRANGEMENT_ID,
      'The new rate is lower.'
    );

    expect(apiClient.post).toHaveBeenCalledWith(`${ackUrlBase}/dissent`, {
      note: 'The new rate is lower.',
    });
    expect(result.kind).toBe('disagreed');
  });

  it('refuses a note over 280 characters without calling the API', async () => {
    await expect(
      payArrangementApi.dissent(
        HOUSEHOLD_ID,
        CARER_ID,
        ARRANGEMENT_ID,
        'x'.repeat(281)
      )
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('payArrangementApi.listAcks', () => {
  it('GETs .../acks and returns the validated rows', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { pay_arrangement_acks: [seenRow] } },
    });

    const result = await payArrangementApi.listAcks(
      HOUSEHOLD_ID,
      CARER_ID,
      ARRANGEMENT_ID
    );

    expect(apiClient.get).toHaveBeenCalledWith(`${ackUrlBase}/acks`);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('seen');
  });

  it('throws on a malformed row rather than returning it', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: { pay_arrangement_acks: [{ ...seenRow, kind: 'agreed' }] },
      },
    });

    await expect(
      payArrangementApi.listAcks(HOUSEHOLD_ID, CARER_ID, ARRANGEMENT_ID)
    ).rejects.toThrow();
  });
});

describe('payArrangementApi.cancelScheduled', () => {
  it('POSTs .../cancel-scheduled and returns the appended revert row', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { pay_arrangement: validArrangement } },
    });

    const result = await payArrangementApi.cancelScheduled(
      HOUSEHOLD_ID,
      CARER_ID,
      ARRANGEMENT_ID
    );

    expect(apiClient.post).toHaveBeenCalledWith(
      `${ackUrlBase}/cancel-scheduled`
    );
    expect(result.id).toBe(ARRANGEMENT_ID);
  });
});
