/**
 * @module api/endpoints/__tests__/householdClosures.test
 * Covers: URL construction (household-nested), request validation,
 * response-envelope unwrap + Zod validation for householdClosureApi.list /
 * create / remove.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let householdClosureApi: any;
let apiClient: any;

const now = '2026-08-01T00:00:00.000Z';
const HOUSEHOLD_ID = '77777777-7777-4777-8777-777777777777';

const validRow = {
  id: '99999999-9999-4999-8999-999999999999',
  household_id: HOUSEHOLD_ID,
  starts_at: '2026-08-10T00:00:00.000Z',
  ends_at: '2026-08-13T00:00:00.000Z',
  message: null,
  created_by: '88888888-8888-4888-8888-888888888888',
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

  const mod = await import('../householdClosures');
  householdClosureApi = mod.householdClosureApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
  apiClient.delete.mockReset?.();
});

describe('householdClosureApi.list', () => {
  it('GETs /v1/households/:householdId/closures and returns the validated rows', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { household_closures: [validRow] } },
    });

    const result = await householdClosureApi.list(HOUSEHOLD_ID);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/closures`
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(validRow.id);
  });

  it('accepts an empty list (no closures declared yet)', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { household_closures: [] } },
    });

    expect(await householdClosureApi.list(HOUSEHOLD_ID)).toEqual([]);
  });

  it('throws when the response fails validation', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { household_closures: [{ starts_at: 'not-a-date' }] } },
    });
    await expect(householdClosureApi.list(HOUSEHOLD_ID)).rejects.toThrow();
  });
});

describe('householdClosureApi.create', () => {
  it('POSTs the validated body to /v1/households/:householdId/closures and returns the singular response', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { household_closure: validRow } },
    });

    const result = await householdClosureApi.create(HOUSEHOLD_ID, {
      starts_at: '2026-08-10T00:00:00.000Z',
      ends_at: '2026-08-13T00:00:00.000Z',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/closures`,
      {
        starts_at: '2026-08-10T00:00:00.000Z',
        ends_at: '2026-08-13T00:00:00.000Z',
      }
    );
    expect(result.id).toBe(validRow.id);
  });

  it('rejects an end that is not after the start, without calling the API', async () => {
    await expect(
      householdClosureApi.create(HOUSEHOLD_ID, {
        starts_at: '2026-08-13T00:00:00.000Z',
        ends_at: '2026-08-10T00:00:00.000Z',
      })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('throws when the response fails validation (e.g. list shape instead of singular)', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { household_closure: [validRow] } },
    });
    await expect(
      householdClosureApi.create(HOUSEHOLD_ID, {
        starts_at: '2026-08-10T00:00:00.000Z',
        ends_at: '2026-08-13T00:00:00.000Z',
      })
    ).rejects.toThrow();
  });
});

describe('householdClosureApi.remove', () => {
  it('DELETEs /v1/households/:householdId/closures/:closureId', async () => {
    apiClient.delete.mockResolvedValue({ data: { data: {} } });

    await householdClosureApi.remove(HOUSEHOLD_ID, validRow.id);

    expect(apiClient.delete).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/closures/${validRow.id}`
    );
  });
});
