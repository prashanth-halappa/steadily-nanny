/**
 * @module app/(private)/(tabs)/home
 *
 * Home screen — the first tab after onboarding.
 *
 * TEMPORARY (Wave 0): the widget kitchen-sink example has been stripped out.
 * This renders an honest empty state until Wave 1 lands the real weekly
 * schedule view. Fetch data through a TanStack Query hook in
 * `src/hooks/queries/` backed by an endpoint module in `src/api/endpoints/`,
 * and compose UI from `src/components/ui`.
 */
import { View } from 'react-native';
import { EmptyState } from '@/src/components/ui/empty-state';

export default function HomeScreen() {
  return (
    <View className="flex-1 bg-background" testID="home-placeholder">
      <EmptyState
        title="Your week will appear here"
        description="Once you add a schedule, upcoming shifts and updates will show up on this screen."
      />
    </View>
  );
}
