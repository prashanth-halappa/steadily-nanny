/**
 * @module api/endpoints/__tests__/schedulePatterns.test
 * Covers: URL construction, request validation, response-envelope unwrap +
 * Zod validation for every schedulePatternApi method. `weekday` is a Postgres
 * `extract(dow)` index (0=Sunday..6=Saturday) — these tests use weekday 3
 * (Wednesday) for the days-replace body to keep that convention visible and
 * distinguishable from a display-order index.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let schedulePatternApi: any;
let apiClient: any;

const now = '2026-01-01T00:00:00Z';

const patternId = '11111111-1111-4111-8111-111111111111';
const householdId = '22222222-2222-4222-8222-222222222222';
const carerId = '33333333-3333-4333-8333-333333333333';
const dayId = '44444444-4444-4444-8444-444444444444';
const childRowId = '55555555-5555-4555-8555-555555555555';
const childId = '66666666-6666-4666-8666-666666666666';

const validPattern = {
  id: patternId,
  household_id: householdId,
  carer_id: carerId,
  status: 'draft',
  rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
  dtstart: '2026-01-05',
  until: null,
  exdates: [],
  pause_ranges: [],
  timezone: 'Europe/London',
  note: null,
  created_by: householdId,
  sent_at: null,
  responded_at: null,
  ical_uid: 'pattern-1@steadilynanny.app',
  sequence: 0,
  created_at: now,
  updated_at: now,
};

const validDay = {
  id: dayId,
  pattern_id: patternId,
  weekday: 3,
  start_time: '08:00',
  end_time: '13:00',
  created_at: now,
  updated_at: now,
};

const validDayChild = {
  id: childRowId,
  pattern_day_id: dayId,
  child_id: childId,
  start_time: null,
  end_time: null,
  created_at: now,
};

const validPatternWithDays = {
  ...validPattern,
  days: [{ ...validDay, children: [validDayChild] }],
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

  const mod = await import('../schedulePatterns');
  schedulePatternApi = mod.schedulePatternApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
  apiClient.put.mockReset?.();
  apiClient.patch.mockReset?.();
});

describe('schedulePatternApi.list', () => {
  it('GETs the household list route and returns validated patterns', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { schedule_patterns: [validPattern] } },
    });

    const result = await schedulePatternApi.list(householdId);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${householdId}/schedule-patterns`
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(patternId);
  });

  it('throws when the response fails validation', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { schedule_patterns: [{ status: 'not-a-status' }] } },
    });
    await expect(schedulePatternApi.list(householdId)).rejects.toThrow();
  });
});

describe('schedulePatternApi.create', () => {
  it('POSTs the create body and returns the validated pattern (no timezone in body)', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { schedule_pattern: validPattern } },
    });

    const result = await schedulePatternApi.create(householdId, {
      carer_id: carerId,
      rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
      dtstart: '2026-01-05',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/households/${householdId}/schedule-patterns`,
      {
        carer_id: carerId,
        rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
        dtstart: '2026-01-05',
      }
    );
    expect(result.id).toBe(patternId);
  });
});

describe('schedulePatternApi.getById', () => {
  it('GETs the pattern detail route with nested days + children', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { schedule_pattern: validPatternWithDays } },
    });

    const result = await schedulePatternApi.getById(patternId);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/schedule-patterns/${patternId}`
    );
    expect(result.days).toHaveLength(1);
    expect(result.days[0].weekday).toBe(3);
    expect(result.days[0].children[0].child_id).toBe(childId);
  });
});

describe('schedulePatternApi.update', () => {
  it('PATCHes only the provided fields', async () => {
    apiClient.patch.mockResolvedValue({
      data: { data: { schedule_pattern: validPattern } },
    });

    await schedulePatternApi.update(patternId, { note: 'Half-term pause' });

    expect(apiClient.patch).toHaveBeenCalledWith(
      `/v1/schedule-patterns/${patternId}`,
      { note: 'Half-term pause' }
    );
  });
});

describe('schedulePatternApi.replaceDays', () => {
  it('PUTs the wholesale days array and returns the pattern with days', async () => {
    apiClient.put.mockResolvedValue({
      data: { data: { schedule_pattern: validPatternWithDays } },
    });

    const result = await schedulePatternApi.replaceDays(patternId, {
      days: [
        {
          weekday: 3,
          start_time: '08:00',
          end_time: '13:00',
          children: [{ child_id: childId }],
        },
      ],
    });

    expect(apiClient.put).toHaveBeenCalledWith(
      `/v1/schedule-patterns/${patternId}/days`,
      {
        days: [
          {
            weekday: 3,
            start_time: '08:00',
            end_time: '13:00',
            children: [{ child_id: childId }],
          },
        ],
      }
    );
    expect(result.days[0].weekday).toBe(3);
  });

  it('rejects a weekday outside 0..6 without calling the API', async () => {
    await expect(
      schedulePatternApi.replaceDays(patternId, {
        days: [{ weekday: 7, start_time: '08:00', end_time: '13:00' }],
      })
    ).rejects.toThrow();
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  // D21 — these three mirror `ReplaceSchedulePatternDaysSchema`'s .refine()s
  // in apps/api/src/domains/schedule/schemas.ts exactly, so a client-side
  // violation gets a local error instead of a generic API 400.

  it('rejects a day-child with start_time set but end_time omitted', async () => {
    await expect(
      schedulePatternApi.replaceDays(patternId, {
        days: [
          {
            weekday: 3,
            start_time: '08:00',
            end_time: '13:00',
            children: [{ child_id: childId, start_time: '09:00' }],
          },
        ],
      })
    ).rejects.toThrow();
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  it('rejects a day-child with end_time set but start_time omitted', async () => {
    await expect(
      schedulePatternApi.replaceDays(patternId, {
        days: [
          {
            weekday: 3,
            start_time: '08:00',
            end_time: '13:00',
            children: [{ child_id: childId, end_time: '12:00' }],
          },
        ],
      })
    ).rejects.toThrow();
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  it('accepts a day-child with both start_time and end_time set', async () => {
    apiClient.put.mockResolvedValue({
      data: { data: { schedule_pattern: validPatternWithDays } },
    });

    await schedulePatternApi.replaceDays(patternId, {
      days: [
        {
          weekday: 3,
          start_time: '08:00',
          end_time: '13:00',
          children: [
            { child_id: childId, start_time: '09:00', end_time: '12:00' },
          ],
        },
      ],
    });

    expect(apiClient.put).toHaveBeenCalled();
  });

  it('rejects a day whose end_time is not after its start_time', async () => {
    await expect(
      schedulePatternApi.replaceDays(patternId, {
        days: [{ weekday: 3, start_time: '13:00', end_time: '08:00' }],
      })
    ).rejects.toThrow();
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  it('rejects two days that repeat the same weekday', async () => {
    await expect(
      schedulePatternApi.replaceDays(patternId, {
        days: [
          { weekday: 3, start_time: '08:00', end_time: '13:00' },
          { weekday: 3, start_time: '14:00', end_time: '17:00' },
        ],
      })
    ).rejects.toThrow();
    expect(apiClient.put).not.toHaveBeenCalled();
  });
});

describe('schedulePatternApi.send', () => {
  it('POSTs the send action with no body', async () => {
    apiClient.post.mockResolvedValue({
      data: {
        data: { schedule_pattern: { ...validPattern, status: 'pending' } },
      },
    });

    const result = await schedulePatternApi.send(patternId);

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/schedule-patterns/${patternId}/send`
    );
    expect(result.status).toBe('pending');
  });
});

describe('schedulePatternApi.respond', () => {
  it('POSTs accepted status', async () => {
    apiClient.post.mockResolvedValue({
      data: {
        data: { schedule_pattern: { ...validPattern, status: 'accepted' } },
      },
    });

    const result = await schedulePatternApi.respond(patternId, {
      status: 'accepted',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/schedule-patterns/${patternId}/respond`,
      { status: 'accepted' }
    );
    expect(result.status).toBe('accepted');
  });
});

describe('schedulePatternApi.withdraw', () => {
  it('POSTs the withdraw action with no body', async () => {
    apiClient.post.mockResolvedValue({
      data: {
        data: { schedule_pattern: { ...validPattern, status: 'withdrawn' } },
      },
    });

    const result = await schedulePatternApi.withdraw(patternId);

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/schedule-patterns/${patternId}/withdraw`
    );
    expect(result.status).toBe('withdrawn');
  });
});
