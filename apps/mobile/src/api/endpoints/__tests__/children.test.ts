/**
 * @module api/endpoints/__tests__/children.test
 * Covers: URL construction, request validation, response-envelope unwrap +
 * Zod validation for every childrenApi method.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let childrenApi: any;
let apiClient: any;

const now = '2026-01-01T00:00:00.000Z';
const householdId = '11111111-1111-4111-8111-111111111111';

const validChild = {
  id: '66666666-6666-4666-8666-666666666666',
  household_id: householdId,
  name: 'Ada',
  birth_date: '2020-01-01',
  colour: '#FFAA00',
  avatar_initial: 'A',
  routine_notes: null,
  archived_at: null,
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

  const mod = await import('../children');
  childrenApi = mod.childrenApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
  apiClient.patch.mockReset?.();
  apiClient.delete.mockReset?.();
});

describe('childrenApi.list', () => {
  it('GETs the household children list', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { children: [validChild] } },
    });

    const result = await childrenApi.list(householdId);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${householdId}/children`
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Ada');
  });
});

describe('childrenApi.create', () => {
  it('POSTs a new child and returns it', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { child: validChild } },
    });

    const result = await childrenApi.create(householdId, { name: 'Ada' });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/households/${householdId}/children`,
      { name: 'Ada' }
    );
    expect(result.id).toBe(validChild.id);
  });

  it('rejects an empty name without calling the API', async () => {
    await expect(
      childrenApi.create(householdId, { name: '' })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('childrenApi.update', () => {
  it('PATCHes the child and returns the updated row', async () => {
    const updated = { ...validChild, name: 'Ada Marie' };
    apiClient.patch.mockResolvedValue({ data: { data: { child: updated } } });

    const result = await childrenApi.update(householdId, validChild.id, {
      name: 'Ada Marie',
    });

    expect(apiClient.patch).toHaveBeenCalledWith(
      `/v1/households/${householdId}/children/${validChild.id}`,
      { name: 'Ada Marie' }
    );
    expect(result.name).toBe('Ada Marie');
  });

  it('rejects an empty patch body without calling the API', async () => {
    await expect(
      childrenApi.update(householdId, validChild.id, {})
    ).rejects.toThrow();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });
});

describe('childrenApi.remove', () => {
  it('DELETEs and returns the archived child', async () => {
    const archived = { ...validChild, archived_at: now };
    apiClient.delete.mockResolvedValue({
      data: { data: { child: archived } },
    });

    const result = await childrenApi.remove(householdId, validChild.id);

    expect(apiClient.delete).toHaveBeenCalledWith(
      `/v1/households/${householdId}/children/${validChild.id}`
    );
    expect(result.archived_at).toBe(now);
  });
});
