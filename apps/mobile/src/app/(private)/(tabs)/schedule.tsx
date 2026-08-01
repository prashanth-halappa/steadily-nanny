/**
 * @module app/(private)/(tabs)/schedule
 *
 * PLACEHOLDER — owned content-wise by the schedule workstream
 * (`src/domains/schedule/**`). This file exists so the parent-only
 * "Schedule" tab (wired in `(tabs)/_layout.tsx`) has a real route to mount
 * instead of crashing expo-router's tab navigator. Replace the body with
 * the real screen (`return <ScheduleScreen />` from `@/src/domains/schedule`)
 * once that domain exports one — no changes to `_layout.tsx` needed.
 */
import { ScrollView } from 'react-native';
import { EmptyState } from '@/src/components/ui/empty-state';

export default function ScheduleRoute() {
  return (
    <ScrollView
      testID="schedule-screen"
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 24, paddingBottom: 100 }}
    >
      <EmptyState
        variant="inline"
        title="Schedule is on its way"
        description="This tab will show the week's shifts once scheduling is wired up."
      />
    </ScrollView>
  );
}
