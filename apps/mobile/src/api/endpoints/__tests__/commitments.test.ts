/**
 * @module api/endpoints/__tests__/commitments.test
 * Wave D — child commitment endpoints.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let commitmentApi: typeof import('../commitments').commitmentApi;
let apiClient: any;

const now = '2026-01-01T00:00:00Z';
const householdId = '22222222-2222-4222-8222-222222222222';
const childId = '33333333-3333-4333-8333-333333333333';
const commitmentId = '44444444-4444-4444-8444-444444444444';

const validCommitment = {
  id: commitmentId,
  child_id: childId,
  household_id: householdId,
  kind: 'preschool',
  label: 'Preschool',
  rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  start_time: '09:00:00',
  end_time: '12:00:00',
  starts_on: null,
  ends_on: null,
  exdates: [],
  excluded_from_cover: true,
  created_at: now,
  updated_at: now,
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

  const mod = await import('../commitments');
  commitmentApi = mod.commitmentApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
  apiClient.patch.mockReset?.();
  apiClient.delete.mockReset?.();
});

describe('commitmentApi.list', () => {
  it('GETs nested child commitments route', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { child_commitments: [validCommitment] } },
    });

    const result = await commitmentApi.list(householdId, childId);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${householdId}/children/${childId}/commitments`
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe('Preschool');
  });
});

describe('commitmentApi.create', () => {
  it('POSTs create body and unwraps child_commitment', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { child_commitment: validCommitment } },
    });

    const result = await commitmentApi.create(householdId, childId, {
      label: 'Preschool',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      start_time: '09:00:00',
      end_time: '12:00:00',
    });

    expect(apiClient.post).toHaveBeenCalled();
    expect(result.id).toBe(commitmentId);
  });
});

describe('commitmentApi.remove', () => {
  it('DELETEs flat commitment route', async () => {
    apiClient.delete.mockResolvedValue({ data: { data: { success: true } } });

    await commitmentApi.remove(commitmentId);

    expect(apiClient.delete).toHaveBeenCalledWith(
      `/v1/commitments/${commitmentId}`
    );
  });
});
