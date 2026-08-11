/**
 * @module domains/setup/__tests__/CalendarPermissionScreen.behavior.test
 *
 * Wizard step shown to parents and nannies only — the true last wizard step
 * for both. Locks in: both CTAs always advance to home (grant, deny, and a
 * permission/sync error all finish onboarding — permissions must never
 * block it), the primary CTA calls the OS permission helper, and a grant
 * turns on calendar sync against a default calendar so sync actually
 * starts.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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

const requestCalendarPermissions = mock(() =>
  Promise.resolve({ granted: false, status: 'denied' })
);
const enableDefaultCalendarSync = mock(() => Promise.resolve(true));
mock.module('@/src/domains/schedule/utils/calendarSyncNative', () => ({
  requestCalendarPermissions,
  enableDefaultCalendarSync,
}));

let CalendarPermissionScreen: typeof import('../components/CalendarPermissionScreen').CalendarPermissionScreen;

beforeAll(async () => {
  ({ CalendarPermissionScreen } = await import(
    '../components/CalendarPermissionScreen'
  ));
});

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  requestCalendarPermissions.mockClear();
  enableDefaultCalendarSync.mockClear();
  requestCalendarPermissions.mockImplementation(() =>
    Promise.resolve({ granted: false, status: 'denied' })
  );
  useSetupProgressStore.setState({
    role: 'parent',
    path: 'create',
    currentStep: 'CALENDAR_PERMISSION',
    householdId: 'household-1',
  });
});

describe('CalendarPermissionScreen', () => {
  it('renders the localized title and both CTAs', () => {
    const { getByTestId, getByText } = render(<CalendarPermissionScreen />);
    expect(getByTestId('calendar-permission-screen-cta')).toBeTruthy();
    expect(getByTestId('calendar-permission-screen-skip')).toBeTruthy();
    expect(getByText('onboarding.calendar.title')).toBeTruthy();
  });

  it('primary CTA requests permission and, on grant, enables default calendar sync before finishing onboarding', async () => {
    requestCalendarPermissions.mockImplementation(() =>
      Promise.resolve({ granted: true, status: 'granted' })
    );
    const { getByTestId } = render(<CalendarPermissionScreen />);
    fireEvent.press(getByTestId('calendar-permission-screen-cta'));

    await waitFor(() =>
      expect(requestCalendarPermissions).toHaveBeenCalledTimes(1)
    );
    await waitFor(() =>
      expect(enableDefaultCalendarSync).toHaveBeenCalledTimes(1)
    );
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/(private)/(tabs)/home')
    );
  });

  it('a denial still finishes onboarding, without enabling sync', async () => {
    const { getByTestId } = render(<CalendarPermissionScreen />);
    fireEvent.press(getByTestId('calendar-permission-screen-cta'));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/(private)/(tabs)/home')
    );
    expect(enableDefaultCalendarSync).not.toHaveBeenCalled();
  });

  it('"Not now" finishes onboarding without calling the permission helper', () => {
    const { getByTestId } = render(<CalendarPermissionScreen />);
    fireEvent.press(getByTestId('calendar-permission-screen-skip'));

    expect(requestCalendarPermissions).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(private)/(tabs)/home');
  });

  it('an error from the permission helper still finishes onboarding', async () => {
    requestCalendarPermissions.mockImplementation(() =>
      Promise.reject(new Error('boom'))
    );
    const { getByTestId } = render(<CalendarPermissionScreen />);
    fireEvent.press(getByTestId('calendar-permission-screen-cta'));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/(private)/(tabs)/home')
    );
  });
});
