/**
 * @module hooks/mutations/__tests__/useRemoveMember.test
 * Covers: the member-removal mutation PATCHes `{ status: 'removed' }` for
 * the given member id, invalidates that household's members query on
 * success, and maps a 409 CONFLICT (member has a running time entry) to a
 * specific error message rather than the generic conflict toast — same
 * pattern as `useUpdateTimeEntry`'s `getTimeEntryEditErrorKey`.
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

const updateMemberMock = mock((_householdId: string, memberId: string) =>
  Promise.resolve({ id: memberId, status: 'removed' })
);
const showErrorToastMock = mock(() => {});

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { updateMember: updateMemberMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
}));

let useRemoveMember: typeof import('../useRemoveMember').useRemoveMember;

beforeAll(async () => {
  useRemoveMember = (await import('../useRemoveMember')).useRemoveMember;
});

beforeEach(() => {
  updateMemberMock.mockReset();
  showErrorToastMock.mockReset();
  updateMemberMock.mockImplementation(
    (_householdId: string, memberId: string) =>
      Promise.resolve({ id: memberId, status: 'removed' })
  );
});

describe('useRemoveMember', () => {
  it('PATCHes the member with status: removed', async () => {
    const { result } = renderHookWithProviders(() =>
      useRemoveMember('household-1')
    );

    await act(async () => {
      await result.current.mutateAsync('member-1');
    });

    expect(updateMemberMock).toHaveBeenCalledWith('household-1', 'member-1', {
      status: 'removed',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('invalidates the household members query on success', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useRemoveMember('household-1')
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync('member-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.household.members('household-1'),
    });
  });

  it('shows a specific message on a 409 (member has a running time entry)', async () => {
    updateMemberMock.mockImplementationOnce(() =>
      Promise.reject({
        response: {
          status: 409,
          data: {
            error: {
              code: 'CONFLICT',
              metadata: { reason: 'MEMBER_HAS_RUNNING_ENTRY' },
            },
          },
        },
      })
    );
    const { result } = renderHookWithProviders(() =>
      useRemoveMember('household-1')
    );

    await act(async () => {
      await expect(result.current.mutateAsync('member-1')).rejects.toBeTruthy();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).toHaveBeenCalledWith(
      'errors:memberHasRunningEntry'
    );
  });

  it('shows the generic error message for a non-conflict failure', async () => {
    updateMemberMock.mockImplementationOnce(() =>
      Promise.reject(new Error('boom'))
    );
    const { result } = renderHookWithProviders(() =>
      useRemoveMember('household-1')
    );

    await act(async () => {
      await expect(result.current.mutateAsync('member-1')).rejects.toThrow(
        'boom'
      );
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).toHaveBeenCalledWith('errors:unknown');
  });
});
