/**
 * @module api/endpoints/__tests__/timesheets.test
 * Covers: URL construction, request validation, response-envelope unwrap +
 * Zod validation for timesheetApi.list / getWeek / approve / query.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let timesheetApi: any;
let apiClient: any;

const now = '2026-08-01T00:00:00.000Z';

const validTimesheet = {
  id: '44444444-4444-4444-8444-444444444444',
  household_id: '22222222-2222-4222-8222-222222222222',
  carer_id: '33333333-3333-4333-8333-333333333333',
  carer_display_name: 'Ines Ferreira',
  week_start: '2026-07-27',
  total_minutes: 554,
  status: 'open',
  approved_by: null,
  approved_at: null,
  query_note: null,
  reopen_reason: null,
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

  const mod = await import('../timesheets');
  timesheetApi = mod.timesheetApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
});

describe('timesheetApi.list', () => {
  it('GETs the household timesheets and returns validated rows', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { timesheets: [validTimesheet] } },
    });

    const result = await timesheetApi.list(validTimesheet.household_id);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${validTimesheet.household_id}/timesheets`
    );
    expect(result).toHaveLength(1);
  });
});

describe('timesheetApi.getWeek', () => {
  it('finds the matching week by filtering the full list client-side, THEN fetches its earnings by id', async () => {
    const otherWeek = {
      ...validTimesheet,
      id: '55555555-5555-4555-8555-555555555555',
      week_start: '2026-08-03',
    };
    const weekWithEarnings = {
      ...validTimesheet,
      earnings: {
        status: 'hours_only',
        week_start: '2026-07-27',
        reason: 'legacy_approval',
      },
    };
    // Both calls go through the SAME `apiClient.get` mock (`list` and
    // `getById` are both GETs) — branch on the URL, matching what the two
    // real endpoints actually receive.
    apiClient.get.mockImplementation((url: string) => {
      if (url === `/v1/households/${validTimesheet.household_id}/timesheets`) {
        return Promise.resolve({
          data: { data: { timesheets: [otherWeek, validTimesheet] } },
        });
      }
      if (url === `/v1/timesheets/${validTimesheet.id}`) {
        return Promise.resolve({
          data: { data: { timesheet: weekWithEarnings } },
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const result = await timesheetApi.getWeek(
      validTimesheet.household_id,
      '2026-07-27'
    );

    // No week_start param on the list call — GET /households/:id/timesheets
    // has no server-side week filter (see
    // apps/api/.../householdTimesheetRoutes.ts).
    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${validTimesheet.household_id}/timesheets`
    );
    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/timesheets/${validTimesheet.id}`
    );
    expect(result?.week_start).toBe('2026-07-27');
    expect(result?.earnings.status).toBe('hours_only');
  });

  it('returns null when no timesheet exists for that week yet, WITHOUT calling getById', async () => {
    apiClient.get.mockResolvedValue({ data: { data: { timesheets: [] } } });

    const result = await timesheetApi.getWeek(
      validTimesheet.household_id,
      '2026-08-03'
    );

    expect(result).toBeNull();
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });
});

describe('timesheetApi.getById', () => {
  it('GETs /timesheets/:id and returns the week WITH its earnings attached', async () => {
    const weekWithEarnings = {
      ...validTimesheet,
      earnings: {
        status: 'no_arrangement',
        week_start: validTimesheet.week_start,
        unpriced_dates: [validTimesheet.week_start],
      },
    };
    apiClient.get.mockResolvedValue({
      data: { data: { timesheet: weekWithEarnings } },
    });

    const result = await timesheetApi.getById(validTimesheet.id);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/timesheets/${validTimesheet.id}`
    );
    expect(result.earnings.status).toBe('no_arrangement');
  });
});

describe('timesheetApi.approve', () => {
  it('POSTs to :id/approve and returns the approved timesheet', async () => {
    const approved = {
      ...validTimesheet,
      status: 'approved',
      approved_at: now,
    };
    apiClient.post.mockResolvedValue({
      data: { data: { timesheet: approved } },
    });

    const result = await timesheetApi.approve(validTimesheet.id);

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/timesheets/${validTimesheet.id}/approve`
    );
    expect(result.status).toBe('approved');
  });
});

describe('timesheetApi.query', () => {
  it('POSTs to :id/query with the note', async () => {
    const queried = {
      ...validTimesheet,
      status: 'queried',
      query_note: 'Thursday looks off',
    };
    apiClient.post.mockResolvedValue({
      data: { data: { timesheet: queried } },
    });

    const result = await timesheetApi.query(validTimesheet.id, {
      note: 'Thursday looks off',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/timesheets/${validTimesheet.id}/query`,
      { note: 'Thursday looks off' }
    );
    expect(result.query_note).toBe('Thursday looks off');
  });

  it('rejects an empty note without calling the API', async () => {
    await expect(
      timesheetApi.query(validTimesheet.id, { note: '' })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
