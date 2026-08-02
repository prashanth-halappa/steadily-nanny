/**
 * @module api/endpoints/__tests__/availability.test
 * Covers: URL construction, request validation, response-envelope unwrap +
 * Zod validation for availabilityApi.getMine / upsertWeekday. Weekday is a
 * Postgres `extract(dow)` index (0=Sunday..6=Saturday) — these tests use
 * weekday 1 (Monday) throughout to keep that convention visible.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let availabilityApi: any;
let apiClient: any;

const now = '2026-01-01T00:00:00.000Z';

const validRow = {
  id: '77777777-7777-4777-8777-777777777777',
  user_id: '88888888-8888-4888-8888-888888888888',
  weekday: 1,
  is_available: true,
  earliest_start: '09:00',
  latest_finish: '17:00',
  evening_mode: 'sometimes',
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

  const mod = await import('../availability');
  availabilityApi = mod.availabilityApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.put.mockReset?.();
});

describe('availabilityApi.getMine', () => {
  it('GETs /v1/availability/me and returns the validated rows', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { carer_availability: [validRow] } },
    });

    const result = await availabilityApi.getMine();

    expect(apiClient.get).toHaveBeenCalledWith('/v1/availability/me');
    expect(result).toHaveLength(1);
    expect(result[0].weekday).toBe(1);
  });

  it('accepts an empty list (no rows saved yet)', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { carer_availability: [] } },
    });

    const result = await availabilityApi.getMine();

    expect(result).toEqual([]);
  });

  it('throws when the response fails validation', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { carer_availability: [{ weekday: 9 }] } },
    });
    await expect(availabilityApi.getMine()).rejects.toThrow();
  });
});

describe('availabilityApi.getForUser', () => {
  // D25 — a parent checking a carer's availability while building a
  // schedule, not the self-view `getMine` covers.
  const userId = '99999999-9999-4999-9999-999999999999';

  it('GETs /v1/availability/:userId and returns the validated rows', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { carer_availability: [validRow] } },
    });

    const result = await availabilityApi.getForUser(userId);

    expect(apiClient.get).toHaveBeenCalledWith(`/v1/availability/${userId}`);
    expect(result).toHaveLength(1);
    expect(result[0].weekday).toBe(1);
  });

  it('accepts an empty list (carer has not set any availability yet)', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { carer_availability: [] } },
    });

    const result = await availabilityApi.getForUser(userId);

    expect(result).toEqual([]);
  });

  it('throws when the response fails validation', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { carer_availability: [{ weekday: 9 }] } },
    });
    await expect(availabilityApi.getForUser(userId)).rejects.toThrow();
  });
});

describe('availabilityApi.upsertWeekday', () => {
  it('PUTs the full row for one weekday and returns the singular response', async () => {
    apiClient.put.mockResolvedValue({
      data: { data: { carer_availability: validRow } },
    });

    const result = await availabilityApi.upsertWeekday({
      weekday: 1,
      is_available: true,
      earliest_start: '09:00',
      latest_finish: '17:00',
      evening_mode: 'sometimes',
    });

    expect(apiClient.put).toHaveBeenCalledWith('/v1/availability/me', {
      weekday: 1,
      is_available: true,
      earliest_start: '09:00',
      latest_finish: '17:00',
      evening_mode: 'sometimes',
    });
    expect(result.weekday).toBe(1);
    expect(result.is_available).toBe(true);
  });

  it('rejects a weekday outside 0..6 without calling the API', async () => {
    await expect(
      availabilityApi.upsertWeekday({ weekday: 7 })
    ).rejects.toThrow();
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  it('throws when the response fails validation (e.g. list shape instead of singular)', async () => {
    apiClient.put.mockResolvedValue({
      data: { data: { carer_availability: [validRow] } },
    });
    await expect(
      availabilityApi.upsertWeekday({ weekday: 1 })
    ).rejects.toThrow();
  });
});
