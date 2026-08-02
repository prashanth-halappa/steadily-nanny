/**
 * @module api/endpoints/__tests__/handoff.test
 * Wave F — handoff note endpoints.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let handoffApi: typeof import('../handoff').handoffApi;
let apiClient: any;

const now = '2026-01-01T00:00:00Z';
const householdId = '22222222-2222-4222-8222-222222222222';
const noteId = '55555555-5555-4555-8555-555555555555';
const localDate = '2026-08-03';

const validNote = {
  id: noteId,
  household_id: householdId,
  local_date: localDate,
  author_id: '66666666-6666-4666-8666-666666666666',
  phase: 'morning',
  chips: ['Slept well'],
  body: null,
  moment_saved_at: null,
  created_at: now,
  updated_at: now,
};

beforeAll(async () => {
  mock.module('@/src/api/client', () => ({
    apiClient: {
      get: mock(() => Promise.resolve({})),
      post: mock(() => Promise.resolve({})),
      patch: mock(() => Promise.resolve({})),
    },
  }));

  const mod = await import('../handoff');
  handoffApi = mod.handoffApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
  apiClient.patch.mockReset?.();
});

describe('handoffApi.list', () => {
  it('GETs handoff notes with local_date query param', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { handoff_notes: [validNote] } },
    });

    const result = await handoffApi.list(householdId, localDate);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${householdId}/handoff-notes?local_date=${encodeURIComponent(localDate)}`
    );
    expect(result[0]?.phase).toBe('morning');
  });
});

describe('handoffApi.create', () => {
  it('POSTs create body and unwraps handoff_note', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { handoff_note: validNote } },
    });

    const result = await handoffApi.create(householdId, {
      local_date: localDate,
      phase: 'morning',
      chips: ['Slept well'],
    });

    expect(apiClient.post).toHaveBeenCalled();
    expect(result.chips).toEqual(['Slept well']);
  });
});

describe('handoffApi.update', () => {
  it('PATCHes save_moment on flat handoff route', async () => {
    apiClient.patch.mockResolvedValue({
      data: {
        data: {
          handoff_note: { ...validNote, moment_saved_at: now },
        },
      },
    });

    const result = await handoffApi.update(noteId, { save_moment: true });

    expect(apiClient.patch).toHaveBeenCalledWith(
      `/v1/handoff-notes/${noteId}`,
      { save_moment: true }
    );
    expect(result.moment_saved_at).toBe(now);
  });
});
