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
const postMock = mock(() =>
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
});
