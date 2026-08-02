/**
 * @module api/endpoints/__tests__/changeRequests.test
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const getMock = mock(() =>
  Promise.resolve({
    data: {
      data: {
        shift_change_requests: [],
      },
    },
  })
);
const postMock = mock(
  (): Promise<{ data: { data: unknown } }> =>
    Promise.resolve({
      data: {
        data: {
          status: 'pending',
          shift_change_request: {
            id: '11111111-1111-4111-8111-111111111111',
            shift_id: '22222222-2222-4222-8222-222222222222',
            requested_by: '33333333-3333-4333-8333-333333333333',
            kind: 'cancel',
            proposed_starts_at: null,
            proposed_ends_at: null,
            message: null,
            response_message: null,
            status: 'pending',
            responded_by: null,
            responded_at: null,
            created_at: '2026-08-01T10:00:00Z',
            updated_at: '2026-08-01T10:00:00Z',
          },
        },
      },
    })
);

mock.module('@/src/api/client', () => ({
  apiClient: { get: getMock, post: postMock, patch: mock() },
}));

describe('changeRequestApi', () => {
  beforeEach(() => {
    getMock.mockClear();
    postMock.mockClear();
  });

  it('lists change requests for a shift', async () => {
    const { changeRequestApi } = await import('../changeRequests');
    const rows = await changeRequestApi.listForShift(
      '22222222-2222-4222-8222-222222222222'
    );
    expect(rows).toEqual([]);
    expect(getMock).toHaveBeenCalled();
  });

  it('creates a cancel change request', async () => {
    const { changeRequestApi } = await import('../changeRequests');
    const result = await changeRequestApi.create(
      '22222222-2222-4222-8222-222222222222',
      { kind: 'cancel' }
    );
    expect(result.status).toBe('pending');
    expect(postMock).toHaveBeenCalled();
  });

  it('creates an extra shift and returns the shift envelope', async () => {
    postMock.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          data: {
            status: 'created',
            shift: {
              id: '44444444-4444-4444-8444-444444444444',
              household_id: '55555555-5555-4555-8555-555555555555',
              carer_id: null,
              starts_at: '2026-08-05T09:00:00.000Z',
              ends_at: '2026-08-05T17:00:00.000Z',
              timezone: 'Europe/London',
              local_date: '2026-08-05',
              kind: 'extra',
              status: 'pending',
              source_pattern_id: null,
              origin: 'parent_proposed',
              is_short_notice: false,
              note: null,
              reason: null,
              cancelled_at: null,
              cancelled_by: null,
              cancellation_paid: false,
              cancellation_message: null,
              ical_uid: 'extra-1@steadilynanny.app',
              sequence: 0,
              created_by: '33333333-3333-4333-8333-333333333333',
              created_at: '2026-08-01T10:00:00Z',
              updated_at: '2026-08-01T10:00:00Z',
              shift_children: [],
            },
          },
        },
      })
    );

    const { changeRequestApi } = await import('../changeRequests');
    const result = await changeRequestApi.createExtra(
      '55555555-5555-4555-8555-555555555555',
      {
        starts_at: '2026-08-05T09:00:00.000Z',
        ends_at: '2026-08-05T17:00:00.000Z',
        timezone: 'Europe/London',
      }
    );

    expect(result.status).toBe('created');
    if (result.status === 'created') {
      expect(result.shift.kind).toBe('extra');
    }
  });

  it('returns pending_approval envelope from createExtra when co-parent sign-off is required', async () => {
    postMock.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          data: {
            status: 'pending_approval',
            approval: { id: 'approval-1' },
          },
        },
      })
    );

    const { changeRequestApi } = await import('../changeRequests');
    const result = await changeRequestApi.createExtra(
      '55555555-5555-4555-8555-555555555555',
      {
        starts_at: '2026-08-05T09:00:00.000Z',
        ends_at: '2026-08-05T17:00:00.000Z',
        timezone: 'Europe/London',
      }
    );

    expect(result).toEqual({
      status: 'pending_approval',
      approval: { id: 'approval-1' },
    });
  });

  it('rejects createExtra body when ends_at is not after starts_at', async () => {
    const { changeRequestApi } = await import('../changeRequests');
    await expect(
      changeRequestApi.createExtra('55555555-5555-4555-8555-555555555555', {
        starts_at: '2026-08-05T17:00:00.000Z',
        ends_at: '2026-08-05T09:00:00.000Z',
        timezone: 'Europe/London',
      })
    ).rejects.toThrow();
    expect(postMock).not.toHaveBeenCalled();
  });
});
