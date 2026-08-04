import { Tabs } from 'expo-router';
import { CalendarDays, Clock, Home, Settings } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, type PressableProps } from 'react-native';
import { useThemeColors } from '@/lib/design-tokens';

/**
 * Main tab bar — Today / Schedule / Hours / Settings for every role, all
 * visible regardless of role (the bar itself is role-uniform). What each
 * role sees ON the Schedule tab is forked in `schedule.tsx`: nanny gets this
 * week's shifts; parent/helper get the household's schedule-pattern state;
 * while role is still resolving, `schedule.tsx` shows a loading, error (with
 * retry), or empty affordance depending on why the role is still null.
 *
 * Tab buttons carry stable `tab-*` testIDs for Maestro (docs/09-TESTING.md §7);
 * title strings are translated and must not be the primary E2E selector.
 */
function tabBarButtonWithTestID(testID: string) {
  // Expo Router's BottomTabBarButtonProps includes `href` (link tabs) which
  // Pressable does not — strip it and forward the rest. Cast at the options
  // boundary so we don't depend on `@react-navigation/bottom-tabs` types.
  return (props: Record<string, unknown>) => {
    const { href: _href, ...rest } = props;
    return <Pressable {...(rest as PressableProps)} testID={testID} />;
  };
}

export default function TabsLayout() {
  const colors = useThemeColors();
  const { t } = useTranslation('common');

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t('tabs.today'),
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
          tabBarButton: tabBarButtonWithTestID('tab-today'),
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: t('tabs.schedule'),
          tabBarIcon: ({ color, size }) => (
            <CalendarDays color={color} size={size} />
          ),
          tabBarButton: tabBarButtonWithTestID('tab-schedule'),
        }}
      />
      <Tabs.Screen
        name="hours"
        options={{
          title: t('tabs.hours'),
          tabBarIcon: ({ color, size }) => <Clock color={color} size={size} />,
          tabBarButton: tabBarButtonWithTestID('tab-hours'),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ color, size }) => (
            <Settings color={color} size={size} />
          ),
          tabBarButton: tabBarButtonWithTestID('tab-settings'),
        }}
      />
    </Tabs>
  );
}
