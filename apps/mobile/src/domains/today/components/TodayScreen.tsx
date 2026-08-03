/**
 * @module domains/today/components/TodayScreen
 *
 * The first tab after setup, for both roles. Shows household context, the
 * nanny's clock-in card, and the entry points into the schedule.
 *
 * Wave B: a nanny can be an accepted member of several households, so WHICH
 * household's data this screen shows can no longer be `households.data?.[0]`
 * — that always showed the same one regardless of which family the nanny
 * actually wants right now. `useActiveHousehold` (not `useHouseholds`
 * directly) resolves that choice; `HouseholdSwitcher` is the only UI for
 * changing it, and renders nothing when there's nothing to switch between
 * (one household, e.g. every parent).
 *
 * `PendingScheduleCard` matters more than it looks: without it a nanny had no
 * way to reach `/schedule/respond/[patternId]` at all — the accept half of
 * "parent proposes, nanny accepts" was only reachable by hand-typing a deep
 * link, which means it was not really shipped. It renders NOTHING when there is
 * no pending week, so it costs an ordinary day nothing.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SCREEN_CONTENT_STYLE, washGradient } from '@/lib/design-tokens';
import { useColorScheme } from '@/lib/useColorScheme';
import { ChildChip } from '@/src/components/ui/child-chip';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, H1 } from '@/src/components/ui/typography';
import { HouseholdSwitcher } from '@/src/domains/household';
import {
  PendingScheduleCard,
  ThisWeeksShiftsCard,
} from '@/src/domains/schedule';
import { canViewParentSchedule, SETUP_ROLES } from '@/src/domains/setup/types';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useHouseholdIsLive } from '../hooks/useHouseholdIsLive';
import { ClockInCard } from './ClockInCard';
import { CoverageGapBanner } from './CoverageGapBanner';
import { HandoffChipsCard } from './HandoffChipsCard';
import { NannyLiveStatusCard } from './NannyLiveStatusCard';

export function TodayScreen() {
  const { t } = useTranslation('today');
  const { isDarkColorScheme } = useColorScheme();
  // Server-derived role, NOT the local setupProgress store — that's
  // in-flight wizard UI state and can be empty/stale for a parent whose
  // household was seeded directly, or who signed in on a fresh device. See
  // useIsOnboarded's header comment.
  const onboarding = useIsOnboarded();
  const activeHousehold = useActiveHousehold();
  const household = activeHousehold.household;
  const children = useChildren(household?.id);
  // Wash while someone is on the clock — caller running OR household week
  // entry running. Stays inside this screen (below the tab navigator).
  const isLive = useHouseholdIsLive(household?.id, household?.timezone);
  const wash = washGradient(isDarkColorScheme);

  return (
    <View className="flex-1 bg-background">
      {isLive ? (
        <LinearGradient
          pointerEvents="none"
          testID="today-live-wash"
          style={StyleSheet.absoluteFill}
          colors={wash.colors}
          locations={wash.locations}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
      ) : null}
      <ScrollView
        className="flex-1"
        contentContainerStyle={SCREEN_CONTENT_STYLE}
      >
        <H1 testID="today-header">{t('screenTitle')}</H1>

        {activeHousehold.isLoading ? (
          <LoadingIndicator />
        ) : household ? (
          <View className="mt-2 gap-4">
            <HouseholdSwitcher />
            <Body
              testID="today-household-name"
              className="text-muted-foreground"
            >
              {household.name}
            </Body>

            {canViewParentSchedule(onboarding.role) ? (
              <View
                className="flex-row flex-wrap gap-2"
                testID="today-children"
              >
                {(children.data ?? []).map(child => (
                  <ChildChip
                    key={child.id}
                    name={child.name}
                    colour={child.colour ?? undefined}
                  />
                ))}
              </View>
            ) : null}

            {canViewParentSchedule(onboarding.role) ? (
              <NannyLiveStatusCard
                householdId={household.id}
                timeZone={household.timezone}
              />
            ) : null}

            {onboarding.role === SETUP_ROLES.NANNY ? (
              <ClockInCard householdId={household.id} />
            ) : null}

            <CoverageGapBanner
              householdId={household.id}
              timeZone={household.timezone}
            />

            {onboarding.role ? (
              <HandoffChipsCard
                householdId={household.id}
                timeZone={household.timezone}
                role={onboarding.role}
              />
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
        {activeHousehold.isLoading || household ? null : (
          <View className="mt-8">
            <EmptyState
              variant="inline"
              title={t('emptyTitle')}
              description={t('emptyDescription')}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
