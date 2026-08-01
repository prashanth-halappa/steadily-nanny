/**
 * @module domains/today/components/TodayScreen
 *
 * The first tab after setup, for both roles. There is no shift/schedule
 * domain yet (deferred — see PROJECT-STATUS "Shift domain (deferred until
 * materialisation lands)"), so this shows household context (who's in the
 * household) plus an honest empty state for the schedule, rather than
 * fabricating shift data.
 */
import { ScrollView, View } from 'react-native';
import { ChildChip } from '@/src/components/ui/child-chip';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, H1 } from '@/src/components/ui/typography';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { useSetupProgressStore } from '@/src/store/setupProgress';

export function TodayScreen() {
  const role = useSetupProgressStore(s => s.role);
  const households = useHouseholds();
  const household = households.data?.[0] ?? null;
  const children = useChildren(household?.id);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 24, paddingBottom: 100 }}
    >
      <H1 testID="today-header">Today</H1>

      {households.isLoading ? (
        <LoadingIndicator />
      ) : household ? (
        <View className="mt-2 gap-4">
          <Body testID="today-household-name" className="text-muted-foreground">
            {household.name}
          </Body>

          {role === SETUP_ROLES.PARENT ? (
            <View className="flex-row flex-wrap gap-2" testID="today-children">
              {(children.data ?? []).map(child => (
                <ChildChip
                  key={child.id}
                  name={child.name}
                  colour={child.colour ?? undefined}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <View className="mt-8">
        <EmptyState
          variant="inline"
          title="Your week will appear here"
          description="Once you add a schedule, upcoming shifts and updates will show up on this screen."
        />
      </View>
    </ScrollView>
  );
}
