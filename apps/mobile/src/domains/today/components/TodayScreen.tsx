/**
 * @module domains/today/components/TodayScreen
 *
 * The first tab after setup, for both roles. Shows household context, the
 * nanny's clock-in card, and the entry points into the schedule.
 *
 * `PendingScheduleCard` matters more than it looks: without it a nanny had no
 * way to reach `/schedule/respond/[patternId]` at all — the accept half of
 * "parent proposes, nanny accepts" was only reachable by hand-typing a deep
 * link, which means it was not really shipped. It renders NOTHING when there is
 * no pending week, so it costs an ordinary day nothing.
 */
import { ScrollView, View } from 'react-native';
import { ChildChip } from '@/src/components/ui/child-chip';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, H1 } from '@/src/components/ui/typography';
import {
  PendingScheduleCard,
  ThisWeeksShiftsCard,
} from '@/src/domains/schedule';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { ClockInCard } from './ClockInCard';

export function TodayScreen() {
  // Server-derived role, NOT the local setupProgress store — that's
  // in-flight wizard UI state and can be empty/stale for a parent whose
  // household was seeded directly, or who signed in on a fresh device. See
  // useIsOnboarded's header comment.
  const onboarding = useIsOnboarded();
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

          {onboarding.role === SETUP_ROLES.PARENT ? (
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

          {onboarding.role === SETUP_ROLES.NANNY ? (
            <ClockInCard householdId={household.id} />
          ) : null}

          {/* Renders nothing unless a week is genuinely waiting for this
              person — deliberately not an empty state. A card announcing its
              own absence is noise on the screen people open most. */}
          <PendingScheduleCard />

          <ThisWeeksShiftsCard />
        </View>
      ) : null}

      {/* Only an honest empty state while there is no household at all. Once
          there is one, the cards above carry the schedule story. */}
      {households.isLoading || household ? null : (
        <View className="mt-8">
          <EmptyState
            variant="inline"
            title="Your week will appear here"
            description="Once you add a schedule, upcoming shifts and updates will show up on this screen."
          />
        </View>
      )}
    </ScrollView>
  );
}
