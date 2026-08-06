/**
 * @module domains/setup/__tests__/NotificationsPermissionScreen.behavior.test
 *
 * Wizard step shown to every role. Locks in: both CTAs always advance
 * (grant, deny-not-now, and permission error all reach the next step —
 * permissions must never block onboarding), the primary CTA actually calls
 * the OS permission helper while "Not now" does not, and mounting the
 * screen records a soft-ask attempt so the iOS primer sheet doesn't nag the
 * same user again shortly after setup.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useNotificationStore } from '@/src/store/notificationStore';
import { useSetupProgressStore } from '@/src/store/setupProgress';

const mockPush = mock();
const mockReplace = mock();
mock.module('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mock(),
    navigate: mock(),
  }),
}));

const askForNotificationPermissions = mock(() => Promise.resolve('granted'));
mock.module('@/src/lib/pushNotification', () => ({
  askForNotificationPermissions,
}));

let NotificationsPermissionScreen: typeof import('../components/NotificationsPermissionScreen').NotificationsPermissionScreen;

beforeAll(async () => {
  ({ NotificationsPermissionScreen } = await import(
    '../components/NotificationsPermissionScreen'
  ));
});

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  askForNotificationPermissions.mockClear();
  askForNotificationPermissions.mockImplementation(() =>
    Promise.resolve('granted')
  );
  useSetupProgressStore.setState({
    role: 'parent',
    currentStep: 'NOTIFICATIONS_PERMISSION',
    householdId: 'household-1',
  });
  useNotificationStore.getState().reset();
});

describe('NotificationsPermissionScreen', () => {
  it('renders the localized title and both CTAs', () => {
    const { getByTestId, getByText } = render(
      <NotificationsPermissionScreen />
    );
    expect(getByTestId('notifications-permission-screen-cta')).toBeTruthy();
    expect(getByTestId('notifications-permission-screen-skip')).toBeTruthy();
    expect(getByText('onboarding.notifications.title')).toBeTruthy();
  });

  it('records a soft-ask attempt as soon as the screen shows, regardless of choice', () => {
    render(<NotificationsPermissionScreen />);
    expect(useNotificationStore.getState().attempts).toBe(1);
    expect(useNotificationStore.getState().lastPromptAt).not.toBeNull();
  });

  it('primary CTA calls the permission helper and advances to the next step (parent/nanny -> calendar)', async () => {
    const { getByTestId } = render(<NotificationsPermissionScreen />);
    fireEvent.press(getByTestId('notifications-permission-screen-cta'));

    await waitFor(() =>
      expect(askForNotificationPermissions).toHaveBeenCalledTimes(1)
    );
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/onboarding/calendar')
    );
    expect(useSetupProgressStore.getState().currentStep).toBe(
      'CALENDAR_PERMISSION'
    );
  });

  it('"Not now" advances without calling the permission helper', () => {
    const { getByTestId } = render(<NotificationsPermissionScreen />);
    fireEvent.press(getByTestId('notifications-permission-screen-skip'));

    expect(askForNotificationPermissions).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/onboarding/calendar');
  });

  it('a denial/error from the permission helper still advances — permissions never block onboarding', async () => {
    askForNotificationPermissions.mockImplementation(() =>
      Promise.reject(new Error('denied'))
    );
    const { getByTestId } = render(<NotificationsPermissionScreen />);
    fireEvent.press(getByTestId('notifications-permission-screen-cta'));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/onboarding/calendar')
    );
  });

  it('a helper has no calendar step — advances straight home', () => {
    useSetupProgressStore.setState({
      role: 'helper',
      currentStep: 'NOTIFICATIONS_PERMISSION',
      householdId: 'household-1',
    });
    const { getByTestId } = render(<NotificationsPermissionScreen />);
    fireEvent.press(getByTestId('notifications-permission-screen-skip'));

    expect(mockReplace).toHaveBeenCalledWith('/(private)/(tabs)/home');
    expect(mockPush).not.toHaveBeenCalled();
  });
});
