/**
 * @module hooks/mutations/__tests__/useDeleteAccount.test
 *
 * Covers: the delete-account mutation calls userApi.deleteAccount() exactly
 * once, resolves successfully on the happy path, and shows a localized error
 * toast (without throwing past the caller) on failure. mock.module() runs
 * before the dynamic import per the service-test pattern (docs/09-TESTING.md).
 */

import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const deleteAccountMock = mock(() =>
  Promise.resolve({ success: true, message: 'Account deleted' })
);
const showErrorToastMock = mock(() => {});

mock.module('@/src/api/endpoints/user', () => ({
  userApi: { deleteAccount: deleteAccountMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
}));

let useDeleteAccount: typeof import('../useDeleteAccount').useDeleteAccount;

beforeAll(async () => {
  useDeleteAccount = (await import('../useDeleteAccount')).useDeleteAccount;
});

describe('useDeleteAccount', () => {
  it('calls userApi.deleteAccount and resolves on success', async () => {
    const { result } = renderHookWithProviders(() => useDeleteAccount());

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(deleteAccountMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('shows a localized error toast when the API call fails', async () => {
    deleteAccountMock.mockImplementationOnce(() =>
      Promise.reject(new Error('boom'))
    );
    const { result } = renderHookWithProviders(() => useDeleteAccount());

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toThrow('boom');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showErrorToastMock).toHaveBeenCalled();
  });
});
