/**
 * @module hooks/mutations/__tests__/useCreateShiftChangeRequest.test
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { CreateShiftChangeRequestInput } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { act, waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const SHIFT_ID = '22222222-2222-4222-8222-222222222222';

const changeRequest = {
  id: '11111111-1111-4111-8111-111111111111',
  shift_id: SHIFT_ID,
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
};

const input: CreateShiftChangeRequestInput = {
  kind: 'cancel',
};

const createMock = mock(() => Promise.resolve(changeRequest));
const showErrorToastMock = mock(() => {});
const showSuccessToastMock = mock(() => {});
const requestCalendarSyncMock = mock(() => {});

mock.module('@/src/api/endpoints/changeRequests', () => ({
  changeRequestApi: { create: createMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: showSuccessToastMock,
}));
mock.module('@/src/domains/schedule/hooks/useCalendarSync', () => ({
  requestCalendarSync: requestCalendarSyncMock,
}));

let useCreateShiftChangeRequest: typeof import('../useCreateShiftChangeRequest').useCreateShiftChangeRequest;

beforeEach(async () => {
  createMock.mockReset();
  createMock.mockImplementation(() => Promise.resolve(changeRequest));
  showErrorToastMock.mockReset();
  showSuccessToastMock.mockReset();
  requestCalendarSyncMock.mockReset();
  useCreateShiftChangeRequest = (await import('../useCreateShiftChangeRequest'))
    .useCreateShiftChangeRequest;
});

describe('useCreateShiftChangeRequest', () => {
  it('shows the owner-only message on a 403 NOT_OWNER, not generic forbidden', async () => {
    createMock.mockImplementationOnce(() =>
      Promise.reject({
        response: {
          status: 403,
          data: {
            error: {
              code: 'FORBIDDEN',
              metadata: { reason: 'NOT_OWNER' },
            },
          },
        },
      })
    );
    const { result } = renderHookWithProviders(() =>
      useCreateShiftChangeRequest()
    );

    await act(async () => {
      await expect(
        result.current.mutateAsync({ shiftId: SHIFT_ID, input })
      ).rejects.toBeTruthy();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).toHaveBeenCalledWith('errors:notHouseholdOwner');
  });
});
