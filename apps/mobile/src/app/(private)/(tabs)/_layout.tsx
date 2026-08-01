import { Tabs } from 'expo-router';
import { Home, Settings } from 'lucide-react-native';
import { useThemeColors } from '@/lib/design-tokens';

/**
 * Minimal 2-tab layout (Home, Settings). EXTEND-HERE: add tabs, and/or swap in a
 * custom `tabBar` for an elevated center action button.
 */
export default function TabsLayout() {
  const colors = useThemeColors();

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
