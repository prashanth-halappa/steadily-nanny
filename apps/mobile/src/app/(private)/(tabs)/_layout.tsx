import { HOUSEHOLD_STATES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { Redirect, Tabs } from 'expo-router';
import { CalendarDays, Clock, Home, Settings } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, type PressableProps } from 'react-native';
import { useThemeColors } from '@/lib/design-tokens';
import { useElevation } from '@/lib/design-tokens/elevation';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';

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

const TAB_ICON_STROKE = { active: 2.25, inactive: 1.75 } as const;

export default function TabsLayout() {
  const colors = useThemeColors();
  const elevation = useElevation();
  const { t } = useTranslation('common');
  const { household } = useActiveHousehold();

  // §5.1, D-36: while the active household is a DRAFT this shell is replaced
  // wholesale by one route. Not hidden tabs and not honest empty states — in
  // a draft there are structurally no shifts, no timesheets, no money and no
  // other person, so three of four tabs would be permanently empty BY DESIGN,
  // and a nanny opening a brand-new app to three empty rooms concludes it is
  // broken rather than that she is early.
  //
  // Resolves to null while the household list is still loading, so a slow
  // query renders the tabs briefly rather than redirecting on a guess. If she
  // ALSO belongs to a live household, the household switcher moves her
  // between the full app and the draft screen.
  if (household?.state === HOUSEHOLD_STATES.DRAFT) {
    return <Redirect href="/(private)/draft" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopWidth: 0,
          ...elevation.card,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t('tabs.today'),
          tabBarIcon: ({ color, size, focused }) => (
            <Home
              color={color}
              size={size}
              strokeWidth={
                focused ? TAB_ICON_STROKE.active : TAB_ICON_STROKE.inactive
              }
            />
          ),
          tabBarButton: tabBarButtonWithTestID('tab-today'),
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: t('tabs.schedule'),
          tabBarIcon: ({ color, size, focused }) => (
            <CalendarDays
              color={color}
              size={size}
              strokeWidth={
                focused ? TAB_ICON_STROKE.active : TAB_ICON_STROKE.inactive
              }
            />
          ),
          tabBarButton: tabBarButtonWithTestID('tab-schedule'),
        }}
      />
      <Tabs.Screen
        name="hours"
        options={{
          title: t('tabs.hours'),
          tabBarIcon: ({ color, size, focused }) => (
            <Clock
              color={color}
              size={size}
              strokeWidth={
                focused ? TAB_ICON_STROKE.active : TAB_ICON_STROKE.inactive
              }
            />
          ),
          tabBarButton: tabBarButtonWithTestID('tab-hours'),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ color, size, focused }) => (
            <Settings
              color={color}
              size={size}
              strokeWidth={
                focused ? TAB_ICON_STROKE.active : TAB_ICON_STROKE.inactive
              }
            />
          ),
          tabBarButton: tabBarButtonWithTestID('tab-settings'),
        }}
      />
    </Tabs>
  );
}
