/**
 * @module api/endpoints/__tests__/timeOff.test
 * Covers: URL construction, request validation, response-envelope unwrap +
 * Zod validation for timeOffApi.list / create / cancel.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let timeOffApi: any;
let apiClient: any;

const now = '2026-08-01T00:00:00.000Z';

const validRow = {
  id: '99999999-9999-4999-8999-999999999999',
  user_id: '88888888-8888-4888-8888-888888888888',
  starts_at: '2026-08-10T00:00:00.000Z',
  ends_at: '2026-08-13T00:00:00.000Z',
  all_day: true,
  message: null,
  status: 'confirmed',
  ical_uid: 'time-off-1@steadily',
  sequence: 0,
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

  const mod = await import('../timeOff');
  timeOffApi = mod.timeOffApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
  apiClient.delete.mockReset?.();
});

describe('timeOffApi.list', () => {
  it('GETs /v1/time-off with no query params and returns the validated rows', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { carer_time_off: [validRow] } },
    });

    const result = await timeOffApi.list();

    expect(apiClient.get).toHaveBeenCalledWith('/v1/time-off');
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('confirmed');
  });

  it('accepts an empty list (no time off requested yet)', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { carer_time_off: [] } },
    });

    expect(await timeOffApi.list()).toEqual([]);
  });

  it('throws when the response fails validation', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { carer_time_off: [{ status: 'not-a-real-status' }] } },
    });
    await expect(timeOffApi.list()).rejects.toThrow();
  });
});

describe('timeOffApi.create', () => {
  it('POSTs the validated body to /v1/time-off and returns the singular response', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { carer_time_off: validRow } },
    });

    const result = await timeOffApi.create({
      starts_at: '2026-08-10T00:00:00.000Z',
      ends_at: '2026-08-13T00:00:00.000Z',
      all_day: true,
    });

    expect(apiClient.post).toHaveBeenCalledWith('/v1/time-off', {
      starts_at: '2026-08-10T00:00:00.000Z',
      ends_at: '2026-08-13T00:00:00.000Z',
      all_day: true,
    });
    expect(result.id).toBe(validRow.id);
    expect(result.status).toBe('confirmed');
  });

  it('rejects an end that is not after the start, without calling the API', async () => {
    await expect(
      timeOffApi.create({
        starts_at: '2026-08-13T00:00:00.000Z',
        ends_at: '2026-08-10T00:00:00.000Z',
      })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('throws when the response fails validation (e.g. list shape instead of singular)', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { carer_time_off: [validRow] } },
    });
    await expect(
      timeOffApi.create({
        starts_at: '2026-08-10T00:00:00.000Z',
        ends_at: '2026-08-13T00:00:00.000Z',
      })
    ).rejects.toThrow();
  });
});

describe('timeOffApi.cancel', () => {
  it('DELETEs /v1/time-off/:id and returns the soft-cancelled row', async () => {
    const cancelledRow = { ...validRow, status: 'cancelled' };
    apiClient.delete.mockResolvedValue({
      data: { data: { carer_time_off: cancelledRow } },
    });

    const result = await timeOffApi.cancel(validRow.id);

    expect(apiClient.delete).toHaveBeenCalledWith(
      `/v1/time-off/${validRow.id}`
    );
    expect(result.status).toBe('cancelled');
    // Soft-cancel: the row itself, not an empty response — id survives.
    expect(result.id).toBe(validRow.id);
  });
});
