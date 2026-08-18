import { Tabs } from 'expo-router';
import { CalendarDays, Clock, Home, Inbox } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, type PressableProps } from 'react-native';
import { useThemeColors } from '@/lib/design-tokens';
import { useElevation } from '@/lib/design-tokens/elevation';

/**
 * Main tab bar — Today / Schedule / Hours / Inbox for every role, all
 * visible regardless of role (the bar itself is role-uniform). Settings is
 * NOT a tab: it is pushed from the `header-settings` icon every root screen
 * carries (`components/ui/settings-header-button.tsx`), because it is
 * visited monthly while the shared record between a family and its carer is
 * visited daily. No badge dot on any tab — the count lives in the Inbox
 * screen's own lead line, where it says what it is
 * (docs/design/00-FOUNDATIONS.md §8.5). What each
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

  // §S6 item 4 / D-36: a draft household no longer redirects out of this
  // shell (that used to strand a nanny who ALSO works for a live family —
  // switching to her own old draft lost her the entire app). The tabs stay
  // mounted always; `TodayScreen` renders `DraftHomeScreen` as its body when
  // the active household is a draft, and Schedule/Hours show honest empty
  // states — see those files.
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
        name="inbox"
        options={{
          title: t('tabs.inbox'),
          tabBarIcon: ({ color, size, focused }) => (
            <Inbox
              color={color}
              size={size}
              strokeWidth={
                focused ? TAB_ICON_STROKE.active : TAB_ICON_STROKE.inactive
              }
            />
          ),
          tabBarButton: tabBarButtonWithTestID('tab-inbox'),
        }}
      />
    </Tabs>
  );
}
