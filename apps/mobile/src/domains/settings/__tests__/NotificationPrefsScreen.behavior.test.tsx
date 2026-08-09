/**
 * @module domains/settings/__tests__/NotificationPrefsScreen.behavior.test
 *
 * Pattern B — render + quiet-hours toggle. Complements the Pattern A
 * source file; proves the switch hydrates from prefs and flips local state.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

const getPrefsMock = mock(() =>
  Promise.resolve({
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    disabledTypes: [] as string[],
    timezone: 'UTC',
  })
);
const updatePrefsMock = mock((input: Record<string, unknown>) =>
  Promise.resolve({
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    disabledTypes: [] as string[],
    timezone: 'Europe/London',
    ...input,
  })
);
const getDeviceTimeZoneMock = mock(() => 'Europe/London');
const showSuccessToastMock = mock(() => undefined);
const mockBack = mock(() => undefined);
let onboardingRole: 'parent' | 'nanny' | 'helper' = 'parent';

mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
  useIsOnboarded: () => ({
    status: 'onboarded' as const,
    role: onboardingRole,
    householdId: 'hh-1',
    isPastMember: false,
  }),
}));

mock.module('@/src/components/ui/switch', () => {
  const React = require('react');
  return {
    Switch: ({
      checked,
      onCheckedChange,
      testID,
    }: {
      checked?: boolean;
      onCheckedChange?: (value: boolean) => void;
      testID?: string;
    }) =>
      React.createElement('Pressable', {
        testID,
        accessibilityState: { checked: !!checked },
        onPress: () => onCheckedChange?.(!checked),
      }),
  };
});

mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: () =>
      React.createElement('View', { testID: 'loading-indicator-container' }),
  };
});

mock.module('@/lib/animations/useReducedMotion', () => ({
  useReducedMotion: mock(() => false),
}));

mock.module('@/src/api/endpoints/notifications', () => ({
  notificationsApi: {
    getPrefs: getPrefsMock,
    updatePrefs: updatePrefsMock,
  },
}));

mock.module('@/src/lib/deviceTimeZone', () => ({
  getDeviceTimeZone: getDeviceTimeZoneMock,
}));

mock.module('@/src/lib/toast', () => ({
  showSuccessToast: showSuccessToastMock,
  showErrorToast: mock(() => undefined),
}));

mock.module('expo-router', () => ({
  useRouter: () => ({ push: mock(), back: mockBack }),
}));

let NotificationPrefsScreen: typeof import('../components/NotificationPrefsScreen').NotificationPrefsScreen;

beforeAll(async () => {
  const mod = await import('../components/NotificationPrefsScreen');
  NotificationPrefsScreen = mod.NotificationPrefsScreen;
});

beforeEach(() => {
  onboardingRole = 'parent';
  useAuthStore.setState({
    session: {
      access_token: 'tok',
      refresh_token: 'ref',
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: 'user-1', email: 'sam@example.com' },
    } as never,
    isInitialized: true,
  });
  getPrefsMock.mockClear();
  updatePrefsMock.mockClear();
  getDeviceTimeZoneMock.mockClear();
  showSuccessToastMock.mockClear();
  mockBack.mockClear();
  getPrefsMock.mockResolvedValue({
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    disabledTypes: [],
    timezone: 'UTC',
  });
  updatePrefsMock.mockImplementation((input: Record<string, unknown>) =>
    Promise.resolve({
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      disabledTypes: [] as string[],
      timezone: 'Europe/London',
      ...input,
    })
  );
});

describe('NotificationPrefsScreen', () => {
  it('renders prefs and toggles quiet hours on', async () => {
    const { getByTestId } = renderWithProviders(<NotificationPrefsScreen />);

    // SafeAreaView test harness drops the shell testID — assert on the
    // quiet-hours control that the screen actually owns.
    await waitFor(() => {
      expect(getByTestId('notification-prefs-quiet-hours')).toBeTruthy();
    });

    const quietSwitch = getByTestId('notification-prefs-quiet-hours');
    expect(quietSwitch.props.accessibilityState.checked).toBe(false);

    fireEvent.press(quietSwitch);

    await waitFor(() => {
      expect(
        getByTestId('notification-prefs-quiet-hours').props.accessibilityState
          .checked
      ).toBe(true);
      expect(getByTestId('notification-prefs-quiet-window')).toBeTruthy();
    });
  });

  it('preserves parent-only disabled_types when a nanny saves her filtered list', async () => {
    onboardingRole = 'nanny';
    getPrefsMock.mockResolvedValue({
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      disabledTypes: ['uncovered_care_detected'],
      timezone: 'UTC',
    });

    const { getByTestId, queryByTestId } = renderWithProviders(
      <NotificationPrefsScreen />
    );

    await waitFor(() => {
      expect(getByTestId('notification-prefs-quiet-hours')).toBeTruthy();
    });

    fireEvent.press(getByTestId('notification-prefs-screen-cta'));

    await waitFor(() => {
      expect(updatePrefsMock).toHaveBeenCalled();
    });

    const saved = updatePrefsMock.mock.calls.at(-1)?.[0] as {
      disabledTypes: string[];
    };
    expect(saved.disabledTypes).toContain('uncovered_care_detected');
    expect(
      queryByTestId('notification-prefs-type-uncovered_care_detected')
    ).toBeNull();
  });
});
