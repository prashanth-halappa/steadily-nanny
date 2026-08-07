/**
 * @module domains/schedule/components/ScheduleShiftsScreen
 *
 * Materialised shifts calendar with week navigation. Used as Schedule tab
 * root for nannies and (when the usual week is accepted) for parents.
 * Route: `/schedule/shifts`.
 *
 * Week offset: 0 = current week; forward clamped at
 * `MATERIALISATION_HORIZON_WEEKS` (shared-types — matches API
 * materialisation horizon); back at −104. Shares `WeekNavHeader` with Hours
 * so the two tabs cannot drift.
 */

import { MATERIALISATION_HORIZON_WEEKS } from '@steadily-nanny/shared-types';
import { type Href, useRouter } from 'expo-router';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { BackButton } from '@/src/components/ui/back-button';
import { Button } from '@/src/components/ui/button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { H1, Small } from '@/src/components/ui/typography';
import { WeekNavHeader } from '@/src/components/ui/week-nav-header';
import { AgendaView } from '@/src/domains/schedule/components/AgendaView';
import {
  CalendarViewSwitcher,
  useCalendarViewPreference,
} from '@/src/domains/schedule/components/CalendarViewSwitcher';
import { CrossFamilyRhythmView } from '@/src/domains/schedule/components/CrossFamilyRhythmView';
import { WeekRibbonView } from '@/src/domains/schedule/components/WeekRibbonView';
import { timeOffCoversLocalDate } from '@/src/domains/schedule/utils/timeOffOverlap';
import { isParentEditorRole } from '@/src/domains/setup/types';
import {
  addWeeks,
  formatWeekRangeLabel,
  getWeekDates,
  getWeekStartISO,
} from '@/src/domains/timesheet/utils/week';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdTimeOff } from '@/src/hooks/queries/useHouseholdTimeOff';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import {
  isShiftsRouteUnavailable,
  useShiftsRange,
} from '@/src/hooks/queries/useShiftsRange';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { wallClockToUtcIso } from '@/src/lib/wallClock';
import { CALENDAR_VIEWS } from '@/src/store/calendarViewStore';

const MAX_WEEKS_BACK = 104;
const MAX_WEEKS_FORWARD = MATERIALISATION_HORIZON_WEEKS;

type ScheduleShiftsScreenProps = {
  /** When false, omits the back affordance (Schedule tab root). */
  showBack?: boolean;
  /** Optional banner above the week nav (accepted-pattern context for parents). */
  patternBanner?: ReactNode;
};

export function ScheduleShiftsScreen({
  showBack = true,
  patternBanner,
}: ScheduleShiftsScreenProps) {
  const { t } = useTranslation('schedule');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const activeHousehold = useActiveHousehold();
  const onboarding = useIsOnboarded();
  const profile = useUserProfile();
  const canAddExtra =
    isParentEditorRole(onboarding.role) && !onboarding.isPastMember;
  const [calendarView, setCalendarView] = useCalendarViewPreference();
  const [weekOffset, setWeekOffset] = useState(0);

  const timeZone =
    activeHousehold.household?.timezone ?? profile.data?.timezone ?? 'UTC';
  const currentWeekStartISO = useMemo(
    () => getWeekStartISO(new Date(), timeZone),
    [timeZone]
  );
  const weekStartISO = useMemo(
    () => addWeeks(currentWeekStartISO, weekOffset),
    [currentWeekStartISO, weekOffset]
  );
  const weekDates = useMemo(() => getWeekDates(weekStartISO), [weekStartISO]);
  const weekRangeLabel = useMemo(
    () => formatWeekRangeLabel(weekDates),
    [weekDates]
  );
  const from = useMemo(
    () => wallClockToUtcIso(weekStartISO, '00:00', timeZone),
    [weekStartISO, timeZone]
  );
  const to = useMemo(
    () => wallClockToUtcIso(addWeeks(weekStartISO, 1), '00:00', timeZone),
    [weekStartISO, timeZone]
  );

  const handlePreviousWeek = useCallback(() => {
    setWeekOffset(offset => Math.max(offset - 1, -MAX_WEEKS_BACK));
  }, []);
  const handleNextWeek = useCallback(() => {
    setWeekOffset(offset => Math.min(offset + 1, MAX_WEEKS_FORWARD));
  }, []);

  const shiftsQuery = useShiftsRange(activeHousehold.householdId, from, to);
  const timeOffQuery = useHouseholdTimeOff(activeHousehold.householdId);
  const timeOff = timeOffQuery.data ?? [];

  const isLoading = activeHousehold.isLoading || shiftsQuery.isLoading;
  // 404 "route not built yet" stays a calm empty — every other query error
  // must offer retry (network blip ≠ "check back soon").
  const routeUnavailable =
    shiftsQuery.isError && isShiftsRouteUnavailable(shiftsQuery.error);
  const showQueryError = shiftsQuery.isError && !routeUnavailable;
  const showUnavailable = routeUnavailable;

  const shifts = shiftsQuery.data ?? [];
  const weekHasAway = useMemo(
    () =>
      timeOff.some(row =>
        weekDates.some(date => timeOffCoversLocalDate(row, date, timeZone))
      ),
    [timeOff, weekDates, timeZone]
  );
  const showEmpty =
    !isLoading &&
    !showUnavailable &&
    !showQueryError &&
    shifts.length === 0 &&
    !weekHasAway;
  const showContent =
    !isLoading &&
    !showUnavailable &&
    !showQueryError &&
    (shifts.length > 0 || weekHasAway);
  const showCrossFamily =
    calendarView === CALENDAR_VIEWS.CROSS_FAMILY &&
    !isLoading &&
    !showUnavailable &&
    !showQueryError &&
    (activeHousehold.households?.length ?? 0) >= 2;

  return (
    <View
      testID="schedule-shifts-screen"
      style={{ flex: 1 }}
      className="bg-background"
    >
      <View
        style={{
          gap: 8,
          paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
          paddingTop: SCREEN_CONTENT_STYLE.padding,
          paddingBottom: 8,
        }}
      >
        {showBack ? (
          <BackButton
            testID="schedule-shifts-back"
            onPress={() => router.back()}
            label={tCommon('back')}
          />
        ) : null}
        <View className="flex-row items-center justify-between gap-2">
          <H1>{t('shifts.screenTitle')}</H1>
          {canAddExtra ? (
            <Button
              testID="schedule-shifts-add-extra"
              variant="ghost"
              size="sm"
              onPress={() =>
                router.push('/(private)/schedule/shifts/extra' as Href)
              }
            >
              <Text className="text-primary">{t('shifts.addExtra')}</Text>
            </Button>
          ) : null}
        </View>
        {patternBanner}
        <WeekNavHeader
          label={weekRangeLabel}
          onPreviousWeek={handlePreviousWeek}
          onNextWeek={handleNextWeek}
          previousAccessibilityLabel={t('shifts.previousWeek')}
          nextAccessibilityLabel={t('shifts.nextWeek')}
          isPreviousDisabled={weekOffset <= -MAX_WEEKS_BACK}
          isNextDisabled={weekOffset >= MAX_WEEKS_FORWARD}
          previousTestID="schedule-week-prev"
          nextTestID="schedule-week-next"
          labelTestID="schedule-week-label"
        />
        <CalendarViewSwitcher value={calendarView} onChange={setCalendarView} />
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

      {showQueryError ? (
        <View testID="schedule-shifts-error" style={{ flex: 1 }}>
          <ErrorState
            variant="network"
            onRetry={() => {
              void shiftsQuery.refetch();
            }}
          />
        </View>
      ) : null}

      {showEmpty && calendarView !== CALENDAR_VIEWS.CROSS_FAMILY ? (
        <View testID="schedule-shifts-empty" style={{ flex: 1 }}>
          <EmptyState
            variant="default"
            image={illustrations.emptySchedule}
            title={t('shifts.empty')}
            description=""
          />
        </View>
      ) : null}

      {showContent && calendarView === CALENDAR_VIEWS.AGENDA ? (
        <AgendaView
          shifts={shifts}
          displayTimeZone={profile.data?.timezone}
          timeOff={timeOff}
          householdTimeZone={timeZone}
          weekDates={weekDates}
          householdId={activeHousehold.householdId}
        />
      ) : null}

      {showContent && calendarView === CALENDAR_VIEWS.WEEK_RIBBON ? (
        <>
          {weekHasAway ? (
            <Small
              testID="schedule-away-summary"
              className="px-5.5 pb-2 text-muted-foreground"
            >
              {t('shifts.awaySummary')}
            </Small>
          ) : null}
          <WeekRibbonView
            shifts={shifts}
            displayTimeZone={
              activeHousehold.household?.timezone ?? profile.data?.timezone
            }
            weekStartsOn={profile.data?.week_starts_on}
            timeOff={timeOff}
            householdTimeZone={timeZone}
            weekDates={weekDates}
          />
        </>
      ) : null}

      {showCrossFamily && activeHousehold.householdId ? (
        <CrossFamilyRhythmView
          households={activeHousehold.households}
          activeHouseholdId={activeHousehold.householdId}
        />
      ) : null}
    </View>
  );
}

/** @deprecated Prefer weekOffset + wallClockToUtcIso; kept for test imports. */
export { currentWeekRange } from '@/src/lib/wallClock';

export type { ScheduleShiftsScreenProps };
