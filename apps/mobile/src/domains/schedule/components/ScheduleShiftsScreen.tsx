/**
 * @module domains/schedule/components/ScheduleShiftsScreen
 *
 * Both parent- and nanny-facing: the current week's materialised shifts
 * with calendar view switcher (2a–2d). Route: `/schedule/shifts`.
 *
 * `GET /v1/households/:householdId/shifts` (`useShiftsRange`) — until it
 * ships, calls 404. This screen MUST tolerate that gracefully.
 *
 * Wave B: fetches shifts for `useActiveHousehold`'s household.
 * Wave E: calendar view switcher + Agenda / Week ribbon / Coverage lanes /
 * Cross-family rhythm views.
 */

import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, H1 } from '@/src/components/ui/typography';
import { AgendaView } from '@/src/domains/schedule/components/AgendaView';
import {
  CalendarViewSwitcher,
  useCalendarViewPreference,
} from '@/src/domains/schedule/components/CalendarViewSwitcher';
import { CoverageLanesView } from '@/src/domains/schedule/components/CoverageLanesView';
import { CrossFamilyRhythmView } from '@/src/domains/schedule/components/CrossFamilyRhythmView';
import { WeekRibbonView } from '@/src/domains/schedule/components/WeekRibbonView';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useChildren } from '@/src/hooks/queries/useChildren';
import {
  isShiftsRouteUnavailable,
  useShiftsRange,
} from '@/src/hooks/queries/useShiftsRange';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { currentWeekRange } from '@/src/lib/localDate';
import { CALENDAR_VIEWS } from '@/src/store/calendarViewStore';

type ScheduleShiftsScreenProps = {
  /** When false, omits the back affordance (Schedule tab root for nannies). */
  showBack?: boolean;
};

export function ScheduleShiftsScreen({
  showBack = true,
}: ScheduleShiftsScreenProps) {
  const { t } = useTranslation('schedule');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const activeHousehold = useActiveHousehold();
  const profile = useUserProfile();
  const children = useChildren(activeHousehold.householdId);
  const [calendarView, setCalendarView] = useCalendarViewPreference();
  const { from, to } = currentWeekRange();
  const shiftsQuery = useShiftsRange(activeHousehold.householdId, from, to);

  const isLoading = activeHousehold.isLoading || shiftsQuery.isLoading;
  const routeUnavailable =
    shiftsQuery.isError && isShiftsRouteUnavailable(shiftsQuery.error);
  const showUnavailable = routeUnavailable || shiftsQuery.isError;

  const shifts = shiftsQuery.data ?? [];
  const showEmpty = !isLoading && !showUnavailable && shifts.length === 0;
  const showContent = !isLoading && !showUnavailable && shifts.length > 0;
  const showCrossFamily =
    calendarView === CALENDAR_VIEWS.CROSS_FAMILY &&
    !isLoading &&
    !showUnavailable &&
    (activeHousehold.households?.length ?? 0) >= 2;

  return (
    <View
      testID="schedule-shifts-screen"
      style={{ flex: 1 }}
      className="bg-background"
    >
      <SafeAreaView style={{ flex: 1 }} className="bg-background">
        <View className="gap-2 px-6 pt-4 pb-2">
          {showBack ? (
            <Pressable
              testID="schedule-shifts-back"
              accessibilityRole="button"
              accessibilityLabel={tCommon('back')}
              onPress={() => router.back()}
              hitSlop={8}
              className="self-start"
            >
              <Body className="text-primary">{`< ${tCommon('back')}`}</Body>
            </Pressable>
          ) : null}
          <H1>{t('shifts.screenTitle')}</H1>
          <CalendarViewSwitcher
            value={calendarView}
            onChange={setCalendarView}
          />
        </View>

        {isLoading ? (
          <View style={{ flex: 1 }} className="items-center justify-center">
            <LoadingIndicator />
          </View>
        ) : null}

        {showUnavailable ? (
          <View testID="schedule-shifts-unavailable" style={{ flex: 1 }}>
            <EmptyState
              variant="default"
              title={t('shifts.screenTitle')}
              description={t('shifts.unavailable')}
            />
          </View>
        ) : null}

        {showEmpty && calendarView !== CALENDAR_VIEWS.CROSS_FAMILY ? (
          <View testID="schedule-shifts-empty" style={{ flex: 1 }}>
            <EmptyState
              variant="default"
              title={t('shifts.empty')}
              description=""
            />
          </View>
        ) : null}

        {showContent && calendarView === CALENDAR_VIEWS.AGENDA ? (
          <AgendaView
            shifts={shifts}
            displayTimeZone={profile.data?.timezone}
          />
        ) : null}

        {showContent && calendarView === CALENDAR_VIEWS.WEEK_RIBBON ? (
          <WeekRibbonView
            shifts={shifts}
            displayTimeZone={
              activeHousehold.household?.timezone ?? profile.data?.timezone
            }
            weekStartsOn={profile.data?.week_starts_on}
          />
        ) : null}

        {showContent && calendarView === CALENDAR_VIEWS.COVERAGE_LANES ? (
          <CoverageLanesView
            shifts={shifts}
            householdChildren={children.data ?? []}
            displayTimeZone={
              activeHousehold.household?.timezone ?? profile.data?.timezone
            }
          />
        ) : null}

        {showCrossFamily && activeHousehold.householdId ? (
          <CrossFamilyRhythmView
            households={activeHousehold.households}
            activeHouseholdId={activeHousehold.householdId}
          />
        ) : null}
      </SafeAreaView>
    </View>
  );
}

export { currentWeekRange };
