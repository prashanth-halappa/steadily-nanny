/**
 * @module app/(private)/settings/__tests__/settings.deleteAccount.test
 *
 * F-B7-1 follow-up: `confirmDeleteAccount`'s bare `catch { return; }` around
 * the delete-account mutation swallowed every failure silently — network
 * drop, 500, timeout, or a future contract drift — with no toast and no
 * state change. The user just sits on a spinner-less confirm sheet with no
 * idea whether anything happened. This locks in that a failed delete (a)
 * tells the user via a toast and (b) never signs out or navigates, since
 * that sequencing is reserved for a genuine successful delete.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Toast } from 'toastify-react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

// Delete-account confirm is a BottomSheetBase (keyboard-aware) — same stub
// shape as settings.behavior.test.tsx.
mock.module('@/src/components/custom/BottomSheetBase', () => {
  const R = require('react');
  return {
    BottomSheetBase: ({
      visible,
      children,
      testID,
    }: {
      visible: boolean;
      children: React.ReactNode;
      testID?: string;
    }) => (visible ? R.createElement('View', { testID }, children) : null),
  };
});

const PARENT_USER_ID = 'parent-user-1';

const householdListMock = mock(() => Promise.resolve([]));
const childrenListMock = mock(() => Promise.resolve([]));
const getProfileMock = mock(() =>
  Promise.resolve({
    user_id: PARENT_USER_ID,
    name: 'Sam',
    city: null,
    country: null,
    preferred_locale: 'en',
  })
);
const deleteAccountMock = mock(() => Promise.reject(new Error('network down')));
const signOutMock = mock(() => Promise.resolve());

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { list: householdListMock },
}));
mock.module('@/src/api/endpoints/children', () => ({
  childrenApi: { list: childrenListMock },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: {
    getProfile: getProfileMock,
    updatePreferredLocale: mock(() => Promise.resolve(null)),
    updateName: mock(() => Promise.resolve(null)),
    deleteAccount: deleteAccountMock,
  },
}));

// Declared, not statically imported — mock.module must register before the
// subject (and its BottomSheetBase import) is resolved.
let SettingsScreen: typeof import('../index').default;

beforeAll(async () => {
  SettingsScreen = (await import('../index')).default;
});

beforeEach(() => {
  householdListMock.mockReset();
  childrenListMock.mockReset();
  deleteAccountMock.mockReset();
  signOutMock.mockReset();
  (Toast.error as unknown as ReturnType<typeof mock>).mockClear?.();
  (router.replace as unknown as ReturnType<typeof mock>).mockClear?.();
  householdListMock.mockImplementation(() => Promise.resolve([]));
  childrenListMock.mockImplementation(() => Promise.resolve([]));
  deleteAccountMock.mockImplementation(() =>
    Promise.reject(new Error('network down'))
  );
  useAuthStore.setState({
    session: { user: { id: PARENT_USER_ID } } as unknown as never,
    isInitialized: true,
    signOut: signOutMock,
  } as never);
});

describe('SettingsScreen — delete account failure', () => {
  it('surfaces a toast and does not sign out or navigate when the delete fails', async () => {
    const { getByTestId } = renderWithProviders(<SettingsScreen />);

    fireEvent.press(getByTestId('settings-delete-account'));
    await waitFor(() =>
      expect(getByTestId('settings-delete-account-confirm')).toBeTruthy()
    );
    fireEvent.press(getByTestId('settings-delete-account-confirm'));

    await waitFor(() => expect(deleteAccountMock).toHaveBeenCalled());
    await waitFor(() => expect(Toast.error).toHaveBeenCalled());

    expect(signOutMock).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalledWith('/welcome');
  });
});
