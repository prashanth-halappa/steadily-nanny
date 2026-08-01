/**
 * @module api/endpoints/__tests__/shifts.test
 * Covers: URL construction (with from/to range params, URL-encoded) and
 * response-envelope unwrap + Zod validation for shiftApi.range. `from`/`to`
 * are full ISO datetime strings with an offset — the backing
 * `GET /households/:householdId/shifts` route validates them with
 * `z.iso.datetime({ offset: true })` and 400s on a plain calendar date, so
 * these fixtures deliberately use full instants, not "YYYY-MM-DD".
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let shiftApi: any;
let apiClient: any;

const now = '2026-01-01T00:00:00Z';
const householdId = '22222222-2222-4222-8222-222222222222';
const shiftId = '77777777-7777-4777-8777-777777777777';

const validShift = {
  id: shiftId,
  household_id: householdId,
  carer_id: '33333333-3333-4333-8333-333333333333',
  starts_at: '2026-01-07T08:00:00Z',
  ends_at: '2026-01-07T13:00:00Z',
  timezone: 'Europe/London',
  local_date: '2026-01-07',
  kind: 'recurring',
  status: 'confirmed',
  source_pattern_id: null,
  origin: 'system_generated',
  is_short_notice: false,
  note: null,
  reason: null,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_paid: false,
  cancellation_message: null,
  ical_uid: 'shift-1@steadilynanny.app',
  sequence: 0,
  created_by: null,
  created_at: now,
  updated_at: now,
};

beforeAll(async () => {
  mock.module('@/src/api/client', () => ({
    apiClient: {
      get: mock(() => Promise.resolve({})),
    },
  }));

  const mod = await import('../shifts');
  shiftApi = mod.shiftApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
});

const from = '2026-01-05T00:00:00.000Z';
const to = '2026-01-12T00:00:00.000Z';

describe('shiftApi.range', () => {
  it('GETs the household shift-range route with URL-encoded ISO-datetime from/to params', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { shifts: [validShift] } },
    });

    const result = await shiftApi.range(householdId, from, to);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${householdId}/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(shiftId);
  });

  it('accepts an empty range (no shifts materialised yet)', async () => {
    apiClient.get.mockResolvedValue({ data: { data: { shifts: [] } } });

    const result = await shiftApi.range(householdId, from, to);

    expect(result).toEqual([]);
  });

  it('throws when the response fails validation', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { shifts: [{ status: 'not-a-status' }] } },
    });
    await expect(shiftApi.range(householdId, from, to)).rejects.toThrow();
  });
});
