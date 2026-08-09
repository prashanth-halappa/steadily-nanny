/**
 * @module hooks/mutations/__tests__/useCreateExtraShift.test
 *
 * D5 item 2 — the server now returns `adopted: true` on the created arm when
 * a double-tap/race adopted an existing shift rather than making a new one.
 * A second "Extra shift proposed" toast (plus re-warning clash toasts) for a
 * shift that already existed is noise, not news, so the adopted case must
 * skip both toasts while still invalidating the caches that make the
 * (already-existing) shift show up/refresh.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import type { CreateExtraShiftResult } from '@/src/api/endpoints/changeRequests';
import { queryKeys } from '@/src/api/queryKeys';
import {
  createTestQueryClient,
  renderHookWithProviders,
} from '@/src/test-utils';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

const shift = {
  id: '77777777-7777-4777-8777-777777777777',
  household_id: HOUSEHOLD_ID,
  carer_id: '33333333-3333-4333-8333-333333333333',
  starts_at: '2026-01-07T08:00:00Z',
  ends_at: '2026-01-07T13:00:00Z',
  timezone: 'Europe/London',
  local_date: '2026-01-07',
  kind: 'extra',
  status: 'confirmed',
  source_pattern_id: null,
  origin: 'parent_proposed',
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
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const input = {
  starts_at: '2026-01-07T08:00:00Z',
  ends_at: '2026-01-07T13:00:00Z',
  timezone: 'Europe/London',
};

const clashWarning = { type: 'OUTSIDE_AVAILABILITY', shift_id: shift.id };

/** Builds a well-typed 'created' arm without fighting the shift schema's
 * literal unions field by field — the payload shape is what's under test
 * here, not the shift record itself. */
function createdResult(
  overrides: Partial<{ adopted: boolean; warnings: unknown[] }> = {}
): CreateExtraShiftResult {
  return {
    status: 'created',
    shift,
    adopted: false,
    warnings: [],
    ...overrides,
  } as CreateExtraShiftResult;
}

const createExtraMock = mock(
  (): Promise<CreateExtraShiftResult> => Promise.resolve(createdResult())
);
const showErrorToastMock = mock(() => {});
const showSuccessToastMock = mock(() => {});
const showClashWarningToastsMock = mock(() => {});
const requestCalendarSyncMock = mock(() => {});

mock.module('@/src/api/endpoints/changeRequests', () => ({
  changeRequestApi: { createExtra: createExtraMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: showSuccessToastMock,
}));
mock.module('@/src/lib/clashWarningToast', () => ({
  showClashWarningToasts: showClashWarningToastsMock,
}));
mock.module('@/src/domains/schedule/hooks/useCalendarSync', () => ({
  requestCalendarSync: requestCalendarSyncMock,
}));

let useCreateExtraShift: typeof import('../useCreateExtraShift').useCreateExtraShift;

beforeEach(async () => {
  createExtraMock.mockReset();
  createExtraMock.mockImplementation(
    (): Promise<CreateExtraShiftResult> => Promise.resolve(createdResult())
  );
  showErrorToastMock.mockReset();
  showSuccessToastMock.mockReset();
  showClashWarningToastsMock.mockReset();
  requestCalendarSyncMock.mockReset();
  useCreateExtraShift = (await import('../useCreateExtraShift'))
    .useCreateExtraShift;
});

describe('useCreateExtraShift', () => {
  it('shows the created toast and clash-warning toasts for an ordinary (non-adopted) create', async () => {
    createExtraMock.mockImplementation(() =>
      Promise.resolve(
        createdResult({ adopted: false, warnings: [clashWarning] })
      )
    );
    const { result } = renderHookWithProviders(() =>
      useCreateExtraShift(HOUSEHOLD_ID)
    );

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(showSuccessToastMock).toHaveBeenCalled();
    expect(showClashWarningToastsMock).toHaveBeenCalledWith(
      [clashWarning],
      expect.any(Function)
    );
  });

  it('skips the success toast and clash-warning toasts when the created shift was adopted', async () => {
    createExtraMock.mockImplementation(() =>
      Promise.resolve(
        createdResult({ adopted: true, warnings: [clashWarning] })
      )
    );
    const { result } = renderHookWithProviders(() =>
      useCreateExtraShift(HOUSEHOLD_ID)
    );

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(showSuccessToastMock).not.toHaveBeenCalled();
    expect(showClashWarningToastsMock).not.toHaveBeenCalled();
  });

  it('still invalidates the shift/me caches and requests a calendar sync when adopted', async () => {
    const client = createTestQueryClient();
    const invalidateSpy = mock(() => Promise.resolve());
    client.invalidateQueries = invalidateSpy as typeof client.invalidateQueries;
    createExtraMock.mockImplementation(() =>
      Promise.resolve(createdResult({ adopted: true }))
    );

    const { result } = renderHookWithProviders(
      () => useCreateExtraShift(HOUSEHOLD_ID),
      { queryClient: client }
    );

    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.shift.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.me.all });
    await waitFor(() => expect(requestCalendarSyncMock).toHaveBeenCalled());
  });

  it('shows the owner-only message on a 403 NOT_OWNER, not generic forbidden', async () => {
    createExtraMock.mockImplementationOnce(() =>
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
      useCreateExtraShift(HOUSEHOLD_ID)
    );

    await act(async () => {
      await expect(result.current.mutateAsync(input)).rejects.toBeTruthy();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).toHaveBeenCalledWith('errors:notHouseholdOwner');
  });
});
