/**
 * @module domains/settings/__tests__/TimeSettingsScreen.calendarSync.test
 *
 * Calendar-sync toggle on Time & calendar — permission denial snaps the
 * toggle back off; choosing a calendar enables sync.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { useCalendarSyncStore } from '@/src/store/calendarSyncStore';
import { renderWithProviders } from '@/src/test-utils';

mock.module('@rn-primitives/alert-dialog', () => {
  const React = require('react');
  const Ctx = React.createContext({
    open: false,
    setOpen: (_open: boolean) => {},
  });
  return {
    Root: ({
      children,
      open,
      onOpenChange,
    }: {
      children: unknown;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) =>
      React.createElement(
        Ctx.Provider,
        {
          value: {
            open: open ?? false,
            setOpen: (next: boolean) => onOpenChange?.(next),
          },
        },
        children
      ),
    Trigger: ({ children }: { children: unknown }) => children,
    Portal: ({ children }: { children: unknown }) => children,
    Overlay: () => null,
    Content: ({ children }: { children: unknown }) => {
      const { open } = React.useContext(Ctx);
      return open ? children : null;
    },
    Title: ({ children }: { children: unknown }) => children,
    Description: ({ children }: { children: unknown }) => children,
    Cancel: ({ children, ...props }: { children: unknown }) =>
      React.createElement('Pressable', props, children),
    Action: ({
      children,
      onPress,
      ...props
    }: {
      children: unknown;
      onPress?: () => void;
    }) => React.createElement('Pressable', { onPress, ...props }, children),
    useRootContext: () => React.useContext(Ctx),
  };
});

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

const getCalendarPermissions = mock(() =>
  Promise.resolve({ granted: false, status: 'denied' })
);
const requestCalendarPermissions = mock(() =>
  Promise.resolve({ granted: false, status: 'denied' })
);
const runDefaultCalendarSync = mock(() => Promise.resolve());
const clearMarkedEventsDefault = mock(() => Promise.resolve());
const listWritableCalendars = mock(
  (): Promise<
    {
      id: string;
      title: string;
      sourceName: string;
      sourceType: string;
      isLocal: boolean;
      allowsModifications: boolean;
    }[]
  > => Promise.resolve([])
);

mock.module('@/src/domains/schedule/utils/calendarSyncNative', () => ({
  getCalendarPermissions,
  requestCalendarPermissions,
  runDefaultCalendarSync,
  clearMarkedEventsDefault,
  listWritableCalendars,
}));

const getProfileMock = mock(() =>
  Promise.resolve({
    user_id: 'parent-user-1',
    name: 'Sam',
    city: null,
    country: null,
    preferred_locale: 'en',
    timezone: 'Europe/London',
    week_starts_on: 1,
  })
);
const updateTimeSettingsMock = mock(() =>
  Promise.resolve({
    user_id: 'parent-user-1',
    name: 'Sam',
    city: null,
    country: null,
    preferred_locale: 'en',
    timezone: 'Europe/London',
    week_starts_on: 1,
  })
);

mock.module('@/src/api/endpoints/user', () => ({
  userApi: {
    getProfile: getProfileMock,
    updateTimeSettings: updateTimeSettingsMock,
  },
}));

let TimeSettingsScreen: typeof import('../components/TimeSettingsScreen').TimeSettingsScreen;

beforeAll(async () => {
  const mod = await import('../components/TimeSettingsScreen');
  TimeSettingsScreen = mod.TimeSettingsScreen;
});

beforeEach(() => {
  useCalendarSyncStore.getState().reset();
  useAuthStore.setState({
    session: {
      access_token: 'tok',
      refresh_token: 'ref',
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: 'parent-user-1', email: 'sam@example.com' },
    } as never,
    isInitialized: true,
  });
  getCalendarPermissions.mockClear();
  requestCalendarPermissions.mockClear();
  clearMarkedEventsDefault.mockClear();
  runDefaultCalendarSync.mockClear();
  getCalendarPermissions.mockResolvedValue({
    granted: false,
    status: 'denied',
  });
  requestCalendarPermissions.mockResolvedValue({
    granted: false,
    status: 'denied',
  });
});

describe('TimeSettingsScreen calendar sync', () => {
  it('snaps the toggle off and shows the permission hint when denied', async () => {
    const { getByTestId } = renderWithProviders(<TimeSettingsScreen />);

    await waitFor(() => {
      expect(getByTestId('time-settings-calendar-sync-switch')).toBeTruthy();
    });

    fireEvent.press(getByTestId('time-settings-calendar-sync-switch'));

    await waitFor(() => {
      expect(useCalendarSyncStore.getState().enabled).toBe(false);
      expect(
        getByTestId('time-settings-calendar-permission-denied')
      ).toBeTruthy();
    });
  });

  it('enables sync after permission + calendar selection', async () => {
    getCalendarPermissions.mockResolvedValue({
      granted: true,
      status: 'granted',
    });
    listWritableCalendars.mockResolvedValue([
      {
        id: 'g-1',
        title: 'Family',
        sourceName: 'Google',
        sourceType: 'com.google',
        isLocal: false,
        allowsModifications: true,
      },
    ]);

    const { getByTestId } = renderWithProviders(<TimeSettingsScreen />);

    await waitFor(() => {
      expect(getByTestId('time-settings-calendar-sync-switch')).toBeTruthy();
    });

    fireEvent.press(getByTestId('time-settings-calendar-sync-switch'));

    await waitFor(() => {
      expect(getByTestId('calendar-option-g-1')).toBeTruthy();
    });

    fireEvent.press(getByTestId('calendar-option-g-1'));

    await waitFor(() => {
      expect(useCalendarSyncStore.getState().enabled).toBe(true);
      expect(useCalendarSyncStore.getState().calendarId).toBe('g-1');
      expect(runDefaultCalendarSync).toHaveBeenCalled();
    });
  });

  it('clears the previous calendar when switching to a different one', async () => {
    useCalendarSyncStore.getState().setEnabled(true);
    useCalendarSyncStore.getState().setCalendar('cal-old', 'Google · Old');
    getCalendarPermissions.mockResolvedValue({
      granted: true,
      status: 'granted',
    });
    listWritableCalendars.mockResolvedValue([
      {
        id: 'cal-old',
        title: 'Old',
        sourceName: 'Google',
        sourceType: 'com.google',
        isLocal: false,
        allowsModifications: true,
      },
      {
        id: 'cal-new',
        title: 'New',
        sourceName: 'Google',
        sourceType: 'com.google',
        isLocal: false,
        allowsModifications: true,
      },
    ]);

    const { getByTestId } = renderWithProviders(<TimeSettingsScreen />);

    await waitFor(() => {
      expect(getByTestId('time-settings-chosen-calendar')).toBeTruthy();
    });
    fireEvent.press(getByTestId('time-settings-chosen-calendar'));

    await waitFor(() => {
      expect(getByTestId('calendar-option-cal-new')).toBeTruthy();
    });
    fireEvent.press(getByTestId('calendar-option-cal-new'));

    await waitFor(() => {
      expect(clearMarkedEventsDefault).toHaveBeenCalledWith('cal-old');
      expect(useCalendarSyncStore.getState().calendarId).toBe('cal-new');
    });
  });

  it('does not clear when re-selecting the same calendar', async () => {
    useCalendarSyncStore.getState().setEnabled(true);
    useCalendarSyncStore.getState().setCalendar('g-1', 'Google · Family');
    getCalendarPermissions.mockResolvedValue({
      granted: true,
      status: 'granted',
    });
    listWritableCalendars.mockResolvedValue([
      {
        id: 'g-1',
        title: 'Family',
        sourceName: 'Google',
        sourceType: 'com.google',
        isLocal: false,
        allowsModifications: true,
      },
    ]);

    const { getByTestId } = renderWithProviders(<TimeSettingsScreen />);

    await waitFor(() => {
      expect(getByTestId('time-settings-chosen-calendar')).toBeTruthy();
    });
    fireEvent.press(getByTestId('time-settings-chosen-calendar'));

    await waitFor(() => {
      expect(getByTestId('calendar-option-g-1')).toBeTruthy();
    });
    fireEvent.press(getByTestId('calendar-option-g-1'));

    await waitFor(() => {
      expect(useCalendarSyncStore.getState().calendarId).toBe('g-1');
    });
    expect(clearMarkedEventsDefault).not.toHaveBeenCalled();
  });

  // REGRESSION: TimeSettingsScreen passed no `onBack` to SetupScreenShell,
  // so the shell rendered neither a back link nor a header chevron — and
  // since this is a full-screen push, the tab bar is hidden too, leaving
  // only an iOS edge-swipe as an escape. Every sibling settings screen
  // (e.g. ManageAvailabilityScreen) passes `onBack={() => router.back()}`;
  // SetupScreenShell derives the back link's testID as `${testID}-back`.
  it('REGRESSION: wires a back link out, matching sibling settings screens', async () => {
    const { getByTestId } = renderWithProviders(<TimeSettingsScreen />);

    await waitFor(() => {
      expect(getByTestId('time-settings-screen-back')).toBeTruthy();
    });

    // Must not throw — proves onBack is a real callback, not a missing prop.
    fireEvent.press(getByTestId('time-settings-screen-back'));
  });
});
