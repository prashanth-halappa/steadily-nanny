/**
 * @module hooks/mutations/__tests__/useRespondToApproval.test
 *
 * Responding to a co-parent approval applies (or rejects) the underlying
 * scheduling action server-side, so a success must invalidate every cache
 * that action can touch: the household's own approvals list (the responded
 * row must disappear from GET /approvals immediately), shifts, schedule
 * patterns, and the me fan-in queries — same broad-invalidate spirit as
 * useRespondToShiftChangeRequest.
 */
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = 'hh-1';
const APPROVAL_ID = 'ap-1';

const respondToApprovalMock = mock(() =>
  Promise.resolve({
    id: APPROVAL_ID,
    household_id: HOUSEHOLD_ID,
    status: 'approved',
  })
);

mock.module('@/src/domains/inbox/api', () => ({
  respondToApproval: respondToApprovalMock,
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
  showSuccessToast: mock(() => {}),
}));

let useRespondToApproval: typeof import('../useRespondToApproval').useRespondToApproval;

beforeAll(async () => {
  useRespondToApproval = (await import('../useRespondToApproval'))
    .useRespondToApproval;
});

beforeEach(() => {
  respondToApprovalMock.mockClear();
});

describe('useRespondToApproval', () => {
  it('responds and invalidates approvals, shift, schedulePattern, and me caches', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useRespondToApproval()
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        householdId: HOUSEHOLD_ID,
        approvalId: APPROVAL_ID,
        status: 'approved',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(respondToApprovalMock).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      APPROVAL_ID,
      'approved'
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.inbox.approvals(HOUSEHOLD_ID),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.shift.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.schedulePattern.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.me.all,
    });
  });

  it('declines with the same call shape', async () => {
    const { result } = renderHookWithProviders(() => useRespondToApproval());

    await act(async () => {
      await result.current.mutateAsync({
        householdId: HOUSEHOLD_ID,
        approvalId: APPROVAL_ID,
        status: 'declined',
      });
    });

    expect(respondToApprovalMock).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      APPROVAL_ID,
      'declined'
    );
  });

  it('surfaces the raw error to the caller on failure', async () => {
    respondToApprovalMock.mockImplementationOnce(() =>
      Promise.reject(new Error('network down'))
    );
    const { result } = renderHookWithProviders(() => useRespondToApproval());

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          householdId: HOUSEHOLD_ID,
          approvalId: APPROVAL_ID,
          status: 'approved',
        })
      ).rejects.toThrow('network down');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
