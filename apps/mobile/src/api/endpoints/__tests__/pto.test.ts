/**
 * @module api/endpoints/__tests__/pto.test
 * Covers: URL construction (incl. `?year=` query param), response-envelope
 * unwrap + Zod validation for `ptoApi.getBalance` / `getLedger` / `markPaid`
 * — including the NEGATIVE `balance_minutes` case (docs/11-MONEY.md §5,
 * TIER0-CX-SPEC.md §5.1: a household can mark more time paid than a carer
 * has accrued; the schema must accept that, never clamp it away).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let ptoApi: any;
let apiClient: any;

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CARER_ID = '33333333-3333-4333-8333-333333333333';
const TIME_OFF_ID = '66666666-6666-4666-8666-666666666666';
const now = '2026-08-01T00:00:00.000Z';

const validBalance = {
  carer_id: CARER_ID,
  household_id: HOUSEHOLD_ID,
  year: 2026,
  entitlement_minutes: 8400,
  accrued_minutes: 8400,
  used_minutes: 2880,
  balance_minutes: 5520,
};

const negativeBalance = {
  ...validBalance,
  used_minutes: 9000,
  balance_minutes: -600,
};

const validLedgerEntry = {
  id: '77777777-7777-4777-8777-777777777777',
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  kind: 'usage',
  minutes: -480,
  effective_date: '2026-08-01',
  time_off_id: TIME_OFF_ID,
  carer_display_name: 'Amara',
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

  const mod = await import('../pto');
  ptoApi = mod.ptoApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
});

describe('ptoApi.getBalance', () => {
  it('GETs the balance route with ?year= and returns the validated balance', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { pto_balance: validBalance } },
    });

    const result = await ptoApi.getBalance(HOUSEHOLD_ID, CARER_ID, 2026);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/carers/${CARER_ID}/pto/balance`,
      { params: { year: 2026 } }
    );
    expect(result?.balance_minutes).toBe(5520);
  });

  it('accepts a NEGATIVE balance_minutes — over-balance is legal, never clamped', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { pto_balance: negativeBalance } },
    });

    const result = await ptoApi.getBalance(HOUSEHOLD_ID, CARER_ID, 2026);

    expect(result?.balance_minutes).toBe(-600);
  });

  it('returns null (not undefined, not thrown) when there is no entitlement/balance to read', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { pto_balance: null } },
    });

    const result = await ptoApi.getBalance(HOUSEHOLD_ID, CARER_ID, 2026);

    expect(result).toBeNull();
  });

  it('throws on a malformed payload instead of returning something half-valid', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: { pto_balance: { ...validBalance, balance_minutes: 'lots' } },
      },
    });

    await expect(
      ptoApi.getBalance(HOUSEHOLD_ID, CARER_ID, 2026)
    ).rejects.toThrow();
  });
});

describe('ptoApi.getLedger', () => {
  it('GETs the ledger route with ?year= and returns the validated rows', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { pto_ledger_entries: [validLedgerEntry] } },
    });

    const result = await ptoApi.getLedger(HOUSEHOLD_ID, CARER_ID, 2026);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/carers/${CARER_ID}/pto/ledger`,
      { params: { year: 2026 } }
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.minutes).toBe(-480);
  });

  it('a signed negative usage minutes value round-trips intact', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { pto_ledger_entries: [validLedgerEntry] } },
    });

    const result = await ptoApi.getLedger(HOUSEHOLD_ID, CARER_ID, 2026);

    expect(result[0]?.kind).toBe('usage');
    expect(result[0]?.minutes).toBeLessThan(0);
  });

  // §5 D-11 / migration 079. `leave_kind` is snapshotted onto the draw by
  // `apply_pto_correction`; a Zod object STRIPS what it does not declare, so
  // without this the label would reach the client and be silently dropped —
  // exactly how `household_member_id` degraded before F4.
  it('carries the sick leave_kind through the response schema unstripped', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          pto_ledger_entries: [{ ...validLedgerEntry, leave_kind: 'sick' }],
        },
      },
    });

    const result = await ptoApi.getLedger(HOUSEHOLD_ID, CARER_ID, 2026);

    expect(result[0]?.leave_kind).toBe('sick');
  });

  it('parses a pre-079 row that carries no leave_kind at all', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { pto_ledger_entries: [validLedgerEntry] } },
    });

    const result = await ptoApi.getLedger(HOUSEHOLD_ID, CARER_ID, 2026);

    expect(result[0]?.leave_kind).toBeUndefined();
  });
});

describe('ptoApi.markPaid', () => {
  it('POSTs the validated body to the household mark-paid route', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { pto_ledger_entry: validLedgerEntry } },
    });

    const result = await ptoApi.markPaid(HOUSEHOLD_ID, {
      time_off_id: TIME_OFF_ID,
      minutes: 480,
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/pto/mark-paid`,
      { time_off_id: TIME_OFF_ID, minutes: 480 }
    );
    expect(result.time_off_id).toBe(TIME_OFF_ID);
  });

  it('passes an optional note through', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { pto_ledger_entry: validLedgerEntry } },
    });

    await ptoApi.markPaid(HOUSEHOLD_ID, {
      time_off_id: TIME_OFF_ID,
      minutes: 480,
      note: 'agreed over text',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/pto/mark-paid`,
      { time_off_id: TIME_OFF_ID, minutes: 480, note: 'agreed over text' }
    );
  });

  it('rejects negative minutes client-side without calling the API', async () => {
    await expect(
      ptoApi.markPaid(HOUSEHOLD_ID, { time_off_id: TIME_OFF_ID, minutes: -10 })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  // Zero is NOT invalid — the Phase 3/4 review moved mark-paid to a
  // total-not-delta model, where a requested total of 0 means "reverse this
  // marking entirely". It is the only way to un-pay a mis-marked time off,
  // so the client must send it rather than reject it.
  it('sends a zero total, the full-reversal instruction, to the API', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { pto_ledger_entry: validLedgerEntry } },
    });

    await ptoApi.markPaid(HOUSEHOLD_ID, {
      time_off_id: TIME_OFF_ID,
      minutes: 0,
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/pto/mark-paid`,
      { time_off_id: TIME_OFF_ID, minutes: 0 }
    );
  });
});
