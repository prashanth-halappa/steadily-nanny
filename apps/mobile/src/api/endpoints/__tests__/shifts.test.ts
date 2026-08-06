/**
 * @module api/endpoints/__tests__/shifts.test
 * Covers range, getById, update, events, day-thread (D23/D24).
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

const validEvent = {
  id: '88888888-8888-4888-8888-888888888888',
  household_id: householdId,
  shift_id: shiftId,
  local_date: '2026-01-07',
  actor_id: '99999999-9999-4999-8999-999999999999',
  event_type: 'shift_updated',
  payload: { before: {}, after: {} },
  created_at: now,
};

beforeAll(async () => {
  mock.module('@/src/api/client', () => ({
    apiClient: {
      get: mock(() => Promise.resolve({})),
      patch: mock(() => Promise.resolve({})),
      post: mock(() => Promise.resolve({})),
    },
  }));

  const mod = await import('../shifts');
  shiftApi = mod.shiftApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.patch.mockReset?.();
  apiClient.post.mockReset?.();
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

describe('shiftApi.getById', () => {
  it('GETs /v1/shifts/:id and unwraps { shift }', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { shift: validShift } },
    });
    const result = await shiftApi.getById(shiftId);
    expect(apiClient.get).toHaveBeenCalledWith(`/v1/shifts/${shiftId}`);
    expect(result.id).toBe(shiftId);
  });
});

describe('shiftApi.update', () => {
  it('PATCHes ParentEditShift fields only and returns the shift + warnings', async () => {
    apiClient.patch.mockResolvedValue({
      data: {
        data: {
          shift: { ...validShift, note: 'Late', origin: 'parent_proposed' },
          warnings: [{ kind: 'outside_availability' }],
        },
      },
    });
    const result = await shiftApi.update(shiftId, { note: 'Late' });
    expect(apiClient.patch).toHaveBeenCalledWith(`/v1/shifts/${shiftId}`, {
      note: 'Late',
    });
    expect(result.shift.note).toBe('Late');
    expect(result.warnings).toEqual([{ kind: 'outside_availability' }]);
  });

  it('rejects an empty body without calling the API', async () => {
    await expect(shiftApi.update(shiftId, {})).rejects.toThrow();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  // This module hand-copies the API's ParentEditShiftSchema, and the copy had
  // drifted: it never grew the ordering refine, so an inverted edit was sent to
  // the server for the API to reject on the round trip.
  it('rejects an inverted edit without calling the API', async () => {
    await expect(
      shiftApi.update(shiftId, {
        starts_at: '2026-01-07T13:00:00Z',
        ends_at: '2026-01-07T08:00:00Z',
      })
    ).rejects.toThrow();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  // GOLDEN-FIXES #25 — the refine must compare instants, not text.
  it('rejects an edit inverted by instant but ordered as text', async () => {
    await expect(
      shiftApi.update(shiftId, {
        starts_at: '2026-01-07T11:00:00-01:00', // 12:00Z
        ends_at: '2026-01-07T11:30:00+00:00', // 11:30Z
      })
    ).rejects.toThrow();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it('sends an edit that is ordered by instant but inverted as text', async () => {
    apiClient.patch.mockResolvedValue({
      data: { data: { shift: validShift, warnings: [] } },
    });
    await shiftApi.update(shiftId, {
      starts_at: '2026-01-07T11:00:00+00:00', // 11:00Z
      ends_at: '2026-01-07T10:30:00-02:00', // 12:30Z
    });
    expect(apiClient.patch).toHaveBeenCalled();
  });

  // Optional-guarded like its API twin — a one-sided edit has no counterpart
  // here to compare against.
  it('still sends a one-sided time edit', async () => {
    apiClient.patch.mockResolvedValue({
      data: { data: { shift: validShift, warnings: [] } },
    });
    await shiftApi.update(shiftId, { ends_at: '2026-01-07T08:00:00Z' });
    expect(apiClient.patch).toHaveBeenCalled();
  });
});

describe('shiftApi.listEvents', () => {
  it('GETs shift-scoped events and unwraps shift_events', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { shift_events: [validEvent] } },
    });
    const result = await shiftApi.listEvents(householdId, shiftId);
    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${householdId}/shifts/${shiftId}/events`
    );
    expect(result[0]?.event_type).toBe('shift_updated');
  });
});

describe('shiftApi.listDayThread', () => {
  it('GETs household/date day-thread including nullable shift_id events', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          shift_events: [{ ...validEvent, shift_id: null }],
        },
      },
    });
    const result = await shiftApi.listDayThread(householdId, '2026-01-07');
    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${householdId}/day-thread?local_date=${encodeURIComponent('2026-01-07')}`
    );
    expect(result[0]?.shift_id).toBeNull();
  });
});

describe('shiftApi.accept', () => {
  it('POSTs /v1/shifts/:id/accept (body-less) and unwraps { shift, warnings }', async () => {
    apiClient.post.mockResolvedValue({
      data: {
        data: {
          shift: {
            ...validShift,
            status: 'confirmed',
            origin: 'parent_proposed',
          },
          warnings: [],
        },
      },
    });

    const result = await shiftApi.accept(shiftId);

    expect(apiClient.post).toHaveBeenCalledWith(`/v1/shifts/${shiftId}/accept`);
    expect(result.shift.status).toBe('confirmed');
    expect(result.warnings).toEqual([]);
  });

  it('defaults missing warnings to [] so Zod does not strip the envelope', async () => {
    apiClient.post.mockResolvedValue({
      data: {
        data: {
          shift: {
            ...validShift,
            status: 'confirmed',
            origin: 'parent_proposed',
          },
        },
      },
    });
    const result = await shiftApi.accept(shiftId);
    expect(result.warnings).toEqual([]);
  });

  it('throws when the response fails validation', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { shift: { status: 'not-a-status' } } },
    });
    await expect(shiftApi.accept(shiftId)).rejects.toThrow();
  });
});
