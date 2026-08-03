/**
 * @module api/endpoints/__tests__/timeEntries.test
 * Covers: URL construction, request validation, response-envelope unwrap +
 * Zod validation for timeEntryApi.clockIn / clockOut / getRunning / listForWeek.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let timeEntryApi: any;
let apiClient: any;

const now = '2026-08-01T00:00:00.000Z';

const validEntry = {
  id: '11111111-1111-4111-8111-111111111111',
  household_id: '22222222-2222-4222-8222-222222222222',
  carer_id: '33333333-3333-4333-8333-333333333333',
  carer_display_name: 'Ines Ferreira',
  shift_id: null,
  clock_in_at: '2026-08-01T07:58:00.000Z',
  clock_out_at: null,
  break_minutes: 0,
  scheduled_minutes: null,
  kind: 'worked',
  note: null,
  clock_in_location_ok: null,
  clock_out_location_ok: null,
  status: 'running',
  local_date: '2026-08-01',
  timezone: 'Europe/London',
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

  const mod = await import('../timeEntries');
  timeEntryApi = mod.timeEntryApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
});

describe('timeEntryApi.clockIn', () => {
  it('POSTs to clock-in and returns the validated entry', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { time_entry: validEntry } },
    });

    const result = await timeEntryApi.clockIn({
      household_id: validEntry.household_id,
    });

    expect(apiClient.post).toHaveBeenCalledWith('/v1/time-entries/clock-in', {
      household_id: validEntry.household_id,
    });
    expect(result.status).toBe('running');
  });

  it('rejects an invalid household_id without calling the API', async () => {
    await expect(
      timeEntryApi.clockIn({ household_id: 'not-a-uuid' })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('timeEntryApi.clockOut', () => {
  it('POSTs to :id/clock-out with break_minutes and note', async () => {
    const clockedOut = {
      ...validEntry,
      clock_out_at: now,
      break_minutes: 30,
      status: 'submitted',
    };
    apiClient.post.mockResolvedValue({
      data: { data: { time_entry: clockedOut } },
    });

    const result = await timeEntryApi.clockOut(validEntry.id, {
      break_minutes: 30,
      note: 'Left early, kids were asleep',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/time-entries/${validEntry.id}/clock-out`,
      { break_minutes: 30, note: 'Left early, kids were asleep' }
    );
    expect(result.status).toBe('submitted');
  });

  it('defaults to an empty body when no options are passed', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { time_entry: validEntry } },
    });

    await timeEntryApi.clockOut(validEntry.id);

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/time-entries/${validEntry.id}/clock-out`,
      {}
    );
  });
});

describe('timeEntryApi.getRunning', () => {
  it('returns the running entry when clocked in', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { time_entry: validEntry } },
    });

    const result = await timeEntryApi.getRunning();

    expect(apiClient.get).toHaveBeenCalledWith('/v1/time-entries/running');
    expect(result?.id).toBe(validEntry.id);
  });

  it('returns null when nobody is clocked in', async () => {
    apiClient.get.mockResolvedValue({ data: { data: { time_entry: null } } });

    const result = await timeEntryApi.getRunning();

    expect(result).toBeNull();
  });
});

describe('timeEntryApi.listForWeek', () => {
  it('GETs the household week with the week_start query param', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { time_entries: [validEntry] } },
    });

    const result = await timeEntryApi.listForWeek(
      validEntry.household_id,
      '2026-07-27'
    );

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${validEntry.household_id}/time-entries`,
      { params: { week_start: '2026-07-27' } }
    );
    expect(result).toHaveLength(1);
  });

  it('throws when the response fails validation', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { time_entries: [{ status: 'not-a-real-status' }] } },
    });
    await expect(
      timeEntryApi.listForWeek(validEntry.household_id, '2026-07-27')
    ).rejects.toThrow();
  });
});
