/**
 * @module hooks/mutations/__tests__/useRevokeInvite.test
 * Covers: the invite-revoke mutation PATCHes `{ status: 'revoked' }` for the
 * given invite id and surfaces a failure via the standard error toast. No
 * list-invites endpoint exists, so there is nothing to invalidate — the
 * caller clears its own local invite state on success.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const updateInviteMock = mock((_householdId: string, inviteId: string) =>
  Promise.resolve({ id: inviteId, status: 'revoked' })
);
const showErrorToastMock = mock(() => {});

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { updateInvite: updateInviteMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
}));

let useRevokeInvite: typeof import('../useRevokeInvite').useRevokeInvite;

beforeAll(async () => {
  useRevokeInvite = (await import('../useRevokeInvite')).useRevokeInvite;
});

beforeEach(() => {
  updateInviteMock.mockReset();
  showErrorToastMock.mockReset();
  updateInviteMock.mockImplementation(
    (_householdId: string, inviteId: string) =>
      Promise.resolve({ id: inviteId, status: 'revoked' })
  );
});

describe('useRevokeInvite', () => {
  it('PATCHes the invite with status: revoked', async () => {
    const { result } = renderHookWithProviders(() =>
      useRevokeInvite('household-1')
    );

    await act(async () => {
      await result.current.mutateAsync('invite-1');
    });

    expect(updateInviteMock).toHaveBeenCalledWith('household-1', 'invite-1', {
      status: 'revoked',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('shows the generic error message on failure', async () => {
    updateInviteMock.mockImplementationOnce(() =>
      Promise.reject(new Error('boom'))
    );
    const { result } = renderHookWithProviders(() =>
      useRevokeInvite('household-1')
    );

    await act(async () => {
      await expect(result.current.mutateAsync('invite-1')).rejects.toThrow(
        'boom'
      );
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).toHaveBeenCalledWith('errors:unknown');
  });
});
