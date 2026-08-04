/**
 * @module api/endpoints/__tests__/me.test
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let meApi: typeof import('../me').meApi;
let apiClient: { get: ReturnType<typeof mock> };

const now = '2026-01-01T00:00:00Z';
const householdId = '22222222-2222-4222-8222-222222222222';
const shiftId = '77777777-7777-4777-8777-777777777777';

const validMeShift = {
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
  membership_role: 'nanny',
};

beforeAll(async () => {
  mock.module('@/src/api/client', () => ({
    apiClient: {
      get: mock(() => Promise.resolve({})),
    },
  }));

  const mod = await import('../me');
  meApi = mod.meApi;
  apiClient = (await import('@/src/api/client')).apiClient as unknown as {
    get: ReturnType<typeof mock>;
  };
});

beforeEach(() => {
  apiClient.get.mockReset?.();
});

const from = '2026-01-05T00:00:00.000Z';
const to = '2026-01-12T00:00:00.000Z';

describe('meApi.listShifts', () => {
  it('GETs /v1/me/shifts with encoded from/to and returns validated MeShifts', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { shifts: [validMeShift] } },
    });

    const result = await meApi.listShifts(from, to);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/me/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.membership_role).toBe('nanny');
  });

  it('throws when membership_role is missing', async () => {
    const { membership_role: _, ...bare } = validMeShift;
    apiClient.get.mockResolvedValue({
      data: { data: { shifts: [bare] } },
    });
    await expect(meApi.listShifts(from, to)).rejects.toThrow();
  });
});

const validChangeRequest = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  shift_id: shiftId,
  requested_by: '11111111-1111-4111-8111-111111111111',
  kind: 'cancel',
  proposed_starts_at: null,
  proposed_ends_at: null,
  message: null,
  response_message: null,
  status: 'pending',
  responded_by: null,
  responded_at: null,
  created_at: now,
  updated_at: now,
};

describe('meApi.listPendingChangeRequests', () => {
  it('GETs /v1/me/change-requests with encoded from/to', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { shift_change_requests: [validChangeRequest] } },
    });

    const result = await meApi.listPendingChangeRequests(from, to);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/me/change-requests?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(validChangeRequest.id);
  });
});
