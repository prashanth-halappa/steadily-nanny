import { Tabs } from 'expo-router';
import { CalendarDays, Clock, Home, Settings } from 'lucide-react-native';
import { useThemeColors } from '@/lib/design-tokens';
import { canViewParentSchedule } from '@/src/domains/setup/types';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';

/**
 * Role-aware tab bar. Parent: Today / Schedule / Hours / Settings. Nanny:
 * Today / Hours / Settings (no Schedule tab). Role comes from
 * `useIsOnboarded()` — SERVER-DERIVED, never a local flag; that hook's
 * header comment explains the re-onboarding bug a local role flag caused.
 * `href: null` hides a `Tabs.Screen` from the tab bar without unmounting
 * its route, so a role that briefly reads as null while loading doesn't
 * flash/remount the navigator once it resolves.
 */
export default function TabsLayout() {
  const colors = useThemeColors();
  const onboarding = useIsOnboarded();
  const canViewSchedule = canViewParentSchedule(onboarding.role);

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
          title: 'Today',
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'Schedule',
          // Parents only — see `PROJECT-STATUS`/team-lead brief: nannies get
          // their week via the Today card + Hours tab, not a Schedule tab.
          href: canViewSchedule ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <CalendarDays color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="hours"
        options={{
          title: 'Hours',
          tabBarIcon: ({ color, size }) => <Clock color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Settings color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
