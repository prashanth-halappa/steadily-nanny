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

import type { FlashListRef } from '@shopify/flash-list';
import { MATERIALISATION_HORIZON_WEEKS } from '@steadily-nanny/shared-types';
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { uncoveredKey } from '@steadily-nanny/shared-types/uncoveredCare';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { SCREEN_CONTENT_STYLE, spacing } from '@/lib/design-tokens';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { BackButton } from '@/src/components/ui/back-button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { ScreenWash } from '@/src/components/ui/screen-wash';
import { Figure28, H1, Small } from '@/src/components/ui/typography';
import { WeekNavHeader } from '@/src/components/ui/week-nav-header';
import {
  type AgendaItem,
  AgendaView,
} from '@/src/domains/schedule/components/AgendaView';
import {
  CalendarViewSwitcher,
  useCalendarViewPreference,
} from '@/src/domains/schedule/components/CalendarViewSwitcher';
import { CrossFamilyRhythmView } from '@/src/domains/schedule/components/CrossFamilyRhythmView';
import { WeekRibbonView } from '@/src/domains/schedule/components/WeekRibbonView';
import { useHouseholdCarers } from '@/src/domains/schedule/hooks/useHouseholdCarers';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import {
  RESOLVED_STATUSES,
  totalCoveringMinutes,
} from '@/src/domains/schedule/utils/shiftGrouping';
import { timeOffCoversLocalDate } from '@/src/domains/schedule/utils/timeOffOverlap';
import { withCauses } from '@/src/domains/schedule/utils/uncoveredDisplay';
import { computeUncoveredWeek } from '@/src/domains/schedule/utils/uncoveredWeek';
import {
  canViewParentSchedule,
  isParentEditorRole,
  SETUP_ROLES,
} from '@/src/domains/setup/types';
import { formatDuration } from '@/src/domains/timesheet/utils/duration';
import {
  addWeeks,
  DEFAULT_WEEK_STARTS_ON,
  formatWeekRangeLabel,
  getWeekDates,
  getWeekStartISO,
  weeksBetween,
} from '@/src/domains/timesheet/utils/week';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdClosures } from '@/src/hooks/queries/useHouseholdClosures';
import { useHouseholdCommitments } from '@/src/hooks/queries/useHouseholdCommitments';
import { useHouseholdTimeOff } from '@/src/hooks/queries/useHouseholdTimeOff';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import {
  isShiftsRouteUnavailable,
  useShiftsRange,
} from '@/src/hooks/queries/useShiftsRange';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { wallClockToUtcIso } from '@/src/lib/wallClock';
import { CALENDAR_VIEWS } from '@/src/store/calendarViewStore';
import { parseDateOnlyLocal } from '@/src/utils/parseDateOnlyLocal';

const MAX_WEEKS_BACK = 104;
const MAX_WEEKS_FORWARD = MATERIALISATION_HORIZON_WEEKS;

type ScheduleShiftsScreenProps = {
  /** When false, omits the back affordance (Schedule tab root). */
  showBack?: boolean;
  /** Optional banner above the week nav (accepted-pattern context for parents). */
  patternBanner?: ReactNode;
  /**
   * The household's active (non-ended) schedule pattern, if any — fetched
   * by the tab route for the banner and passed down here too, purely to
   * fork the empty-state copy (0.2): "no accepted pattern yet" reads very
   * differently from "accepted, this particular week is just empty".
   */
  pattern?: SchedulePattern | null;
  /** True while `pattern` above is still resolving — folded into the
   * loading gate for cover-viewing roles so the empty state doesn't flash
   * the wrong fork before it settles. */
  patternLoading?: boolean;
};

export function ScheduleShiftsScreen({
  showBack = true,
  patternBanner,
  pattern = null,
  patternLoading = false,
}: ScheduleShiftsScreenProps) {
  const { t } = useTranslation('schedule');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const params = useLocalSearchParams<{
    localDate?: string;
    focusUncovered?: string;
    householdId?: string;
  }>();
  const activeHousehold = useActiveHousehold();
  const onboarding = useIsOnboarded();
  const profile = useUserProfile();
  const canAddExtra =
    isParentEditorRole(onboarding.role) && !onboarding.isPastMember;
  const canViewCover = canViewParentSchedule(onboarding.role);
  const canEditCover =
    isParentEditorRole(onboarding.role) && !onboarding.isPastMember;
  const [calendarView, setCalendarView] = useCalendarViewPreference();
  const focusUncovered = params.focusUncovered === '1';
  const arrivalLocalDate =
    typeof params.localDate === 'string' && params.localDate.length > 0
      ? params.localDate
      : null;
  const [weekOffset, setWeekOffset] = useState(0);
  const agendaListRef = useRef<FlashListRef<AgendaItem> | null>(null);
  const [scrollToUncoveredKey, setScrollToUncoveredKey] = useState<
    string | null
  >(null);
  // Only the error branch needs this — `showUnavailable`/`showEmpty` moved to
  // EmptyState's `inline` variant instead (0.3), which is content-sized, not
  // a self-centering flex:1 box. `ErrorState` has no such variant (other
  // callers depend on it), so its wrapper reserves the space directly.
  const tabBarScrollPadding = useTabBarScrollPadding();

  const timeZone =
    activeHousehold.household?.timezone ?? profile.data?.timezone ?? 'UTC';
  // The HOUSEHOLD's business week, not `profile.data.week_starts_on` — that
  // column is a per-user calendar DISPLAY preference and answers a different
  // question (see domains/timesheet/utils/week.ts's header). It anchors both
  // this screen's date range AND `WeekRibbonView`'s column order below: on a
  // screen that renders a business week the household's first day wins over
  // the per-user preference, or the ribbon's first column would be a day
  // that isn't the start of the week being shown.
  const weekStartsOn =
    activeHousehold.household?.week_starts_on ?? DEFAULT_WEEK_STARTS_ON;
  const currentWeekStartISO = useMemo(
    () => getWeekStartISO(new Date(), timeZone, weekStartsOn),
    [timeZone, weekStartsOn]
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
  const commitmentsQuery = useHouseholdCommitments(activeHousehold.householdId);
  const closuresQuery = useHouseholdClosures(activeHousehold.householdId);
  const carersQuery = useHouseholdCarers(activeHousehold.householdId);
  const timeOff = timeOffQuery.data ?? [];

  // Folding commitments/pattern loading in for cover-viewing roles only —
  // otherwise a parent sees the empty state flash before `uncoveredWeek`
  // (below) has real data to flip it into the agenda (P0 known nit).
  const isLoading =
    activeHousehold.isLoading ||
    shiftsQuery.isLoading ||
    (canViewCover && (commitmentsQuery.isLoading || patternLoading));
  // 404 "route not built yet" stays a calm empty — every other query error
  // must offer retry (network blip ≠ "check back soon").
  const routeUnavailable =
    shiftsQuery.isError && isShiftsRouteUnavailable(shiftsQuery.error);
  const showQueryError = shiftsQuery.isError && !routeUnavailable;
  const showUnavailable = routeUnavailable;

  const shifts = shiftsQuery.data ?? [];
  // The week-total anchor (daylight-v2 §2, "the highest-value addition on
  // this screen") — same excludes-cancelled/declined rule AgendaView's
  // per-day totals use, summed over the fetched week instead of one day.
  const weekTotalMinutes = useMemo(
    () => totalCoveringMinutes(shifts),
    [shifts]
  );
  const coveringShifts = useMemo(
    () => shifts.filter(shift => !RESOLVED_STATUSES.has(shift.status)),
    [shifts]
  );
  const coveringDayCount = useMemo(
    () => new Set(coveringShifts.map(shift => shift.local_date)).size,
    [coveringShifts]
  );
  const nannyFirstName =
    resolveCarerName(carersQuery.data?.[0], '').trim().split(/\s+/)[0] ?? '';
  const uncoveredWeek = useMemo(() => {
    if (!canViewCover) {
      return { byDay: {} as Record<string, never[]>, totalCount: 0 };
    }
    const raw = computeUncoveredWeek({
      weekDates,
      timezone: timeZone,
      commitments: commitmentsQuery.data ?? [],
      shifts,
      closures: closuresQuery.data ?? [],
    });
    const byDay: Record<string, ReturnType<typeof withCauses>> = {};
    for (const [date, windows] of Object.entries(raw.byDay)) {
      byDay[date] = withCauses(windows, shifts);
    }
    return { byDay, totalCount: raw.totalCount };
  }, [
    canViewCover,
    weekDates,
    timeZone,
    commitmentsQuery.data,
    shifts,
    closuresQuery.data,
  ]);

  const focusUncoveredKey = useMemo(() => {
    if (!arrivalLocalDate || !focusUncovered) {
      return null;
    }
    const first = uncoveredWeek.byDay[arrivalLocalDate]?.[0];
    return first ? uncoveredKey(first) : null;
  }, [arrivalLocalDate, focusUncovered, uncoveredWeek.byDay]);

  useEffect(() => {
    if (!arrivalLocalDate || !focusUncovered) {
      return;
    }
    const targetWeekStart = getWeekStartISO(
      parseDateOnlyLocal(arrivalLocalDate),
      timeZone,
      weekStartsOn
    );
    const offset = weeksBetween(currentWeekStartISO, targetWeekStart);
    setWeekOffset(offset);
    if (calendarView !== CALENDAR_VIEWS.AGENDA) {
      setCalendarView(CALENDAR_VIEWS.AGENDA);
    }
    if (focusUncoveredKey) {
      setScrollToUncoveredKey(focusUncoveredKey);
    }
  }, [
    arrivalLocalDate,
    focusUncovered,
    timeZone,
    weekStartsOn,
    currentWeekStartISO,
    calendarView,
    setCalendarView,
    focusUncoveredKey,
  ]);

  const firstUncoveredKey = useMemo(() => {
    for (const date of weekDates) {
      const first = uncoveredWeek.byDay[date]?.[0];
      if (first) {
        return uncoveredKey(first);
      }
    }
    return null;
  }, [weekDates, uncoveredWeek.byDay]);
  const weekHasAway = useMemo(
    () =>
      timeOff.some(row =>
        weekDates.some(date => timeOffCoversLocalDate(row, date, timeZone))
      ),
    [timeOff, weekDates, timeZone]
  );
  // P0: uncovered windows used to belong to NEITHER predicate — with 0
  // shifts and N uncovered windows, showEmpty won and AgendaView (the only
  // renderer of uncovered rows and their actions) never mounted, so the
  // week-summary line above pointed at a screen that then said "No shifts
  // yet" right below it. Fold uncovered-for-this-viewer into showContent
  // and out of showEmpty so the two lines can't disagree.
  const hasUncoveredForViewer = canViewCover && uncoveredWeek.totalCount > 0;
  const showEmpty =
    !isLoading &&
    !showUnavailable &&
    !showQueryError &&
    shifts.length === 0 &&
    !weekHasAway &&
    !hasUncoveredForViewer;
  const showContent =
    !isLoading &&
    !showUnavailable &&
    !showQueryError &&
    (shifts.length > 0 || weekHasAway || hasUncoveredForViewer);
  // S12: "Schedule" means "my shifts this week" to a nanny and "the
  // household's weekly pattern" to a parent — the tab label stays uniform
  // (direction doc §11a) but the voice forks here, inside the screen. A
  // helper gets the PARENT voice, not a third one: `canViewParentSchedule`
  // already treats parent+helper as one audience for this exact screen (they
  // see the household's schedule, read-only), so the heading follows suit.
  const isNannyVoice = onboarding.role === SETUP_ROLES.NANNY;
  const familyName =
    activeHousehold.household?.name ?? t('household:untitledDraft');
  const heading = isNannyVoice
    ? t('shifts.nannyHeading')
    : t('shifts.parentHeading');
  const subtitle = isNannyVoice
    ? t('shifts.nannySubtitle', { familyName })
    : t('shifts.parentSubtitle');
  const lead = isNannyVoice
    ? t('lead.nanny', {
        count: coveringShifts.length,
        hours: formatDuration(weekTotalMinutes),
      })
    : nannyFirstName
      ? t('lead.parent', {
          name: nannyFirstName,
          count: coveringDayCount,
        })
      : t('lead.parentNoCarer', {
          count: coveringDayCount,
        });

  // P0 0.2: a shared "No shifts yet" read as "you have nothing on" to a
  // nanny when the truth was "nobody has done their part yet" — fork by
  // viewer voice x whether an accepted pattern exists. An accepted pattern
  // with a genuinely empty week gets the plain, honest line for both.
  const hasAcceptedPattern = pattern?.status === 'accepted';
  const emptyState = hasAcceptedPattern
    ? { title: t('shifts.empty'), description: '' }
    : isNannyVoice
      ? {
          title: t('shifts.emptyPatternPendingTitle', { familyName }),
          description: t('shifts.emptyPatternPendingBody'),
        }
      : {
          title: t('shifts.emptyBuildParentTitle'),
          description: nannyFirstName
            ? t('shifts.emptyBuildParentBody', { name: nannyFirstName })
            : t('shifts.emptyBuildParentBodyNoCarer'),
          // Building a usual week is a parent-editor action, same gate as
          // "Add a one-off shift" above — a helper or a past member gets
          // the copy with no action to take.
          action: canAddExtra
            ? () => router.push('/(private)/schedule/build' as Href)
            : undefined,
          actionLabel: canAddExtra
            ? t('shifts.emptyBuildParentCta')
            : undefined,
        };

  const showCrossFamily =
    calendarView === CALENDAR_VIEWS.CROSS_FAMILY &&
    // TIER0-CX-SPEC §5.2: household names are nanny-only. The switcher
    // already hides this view from a parent (CalendarViewSwitcher's
    // `nannyOnly`), but Rhythm now renders real household names, so the
    // gate belongs here too, where the data actually renders — not only
    // where the tab is offered.
    onboarding.role === SETUP_ROLES.NANNY &&
    !isLoading &&
    !showUnavailable &&
    !showQueryError &&
    (activeHousehold.households?.length ?? 0) >= 2;

  // The header scrolls with the content — it is handed to whichever view is
  // on screen as its list header, not stacked frozen above it.
  const header = (
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
      <View className="gap-1">
        <View className="flex-row items-center justify-between gap-2">
          <H1>{heading}</H1>
          {canAddExtra ? (
            // Small/14/600, not a ghost Button (16 @600) — it was reading
            // as heavy as the H1 beside it.
            <Pressable
              testID="schedule-shifts-add-extra"
              accessibilityRole="button"
              hitSlop={8}
              style={{ minHeight: spacing.minTouchTarget }}
              className="justify-center"
              onPress={() =>
                router.push('/(private)/schedule/shifts/extra' as Href)
              }
            >
              <Small weight="semibold" className="text-primary">
                {t('shifts.addExtra')}
              </Small>
            </Pressable>
          ) : null}
        </View>
        <Small className="text-muted-strong">{subtitle}</Small>
        <Small testID="schedule-lead" className="text-muted-strong">
          {lead}
        </Small>
        <Small tabular className="text-muted-strong">
          {weekRangeLabel}
        </Small>
        <Figure28 testID="schedule-week-total">
          {t('shifts.weekTotal', {
            duration: formatDuration(weekTotalMinutes),
          })}
        </Figure28>
      </View>
      {patternBanner}
      {canViewCover && uncoveredWeek.totalCount > 0 ? (
        <Pressable
          testID="schedule-cover-week-summary"
          accessibilityRole="button"
          onPress={() => {
            if (firstUncoveredKey) {
              setScrollToUncoveredKey(firstUncoveredKey);
            }
            if (calendarView !== CALENDAR_VIEWS.AGENDA) {
              setCalendarView(CALENDAR_VIEWS.AGENDA);
            }
          }}
        >
          <Small className="text-warning-strong" weight="medium">
            {t('cover.weekSummaryTitle', { count: uncoveredWeek.totalCount })}
          </Small>
        </Pressable>
      ) : null}
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
  );
  // Agenda's FlashList has no horizontal padding of its own; the two
  // ScrollViews pad their content container, so the header cancels it.
  const gutterlessHeader = (
    <View style={{ marginHorizontal: -SCREEN_CONTENT_STYLE.padding }}>
      {header}
      {weekHasAway ? (
        <Small
          testID="schedule-away-summary"
          className="px-5.5 pb-2 text-muted-strong"
        >
          {t('shifts.awaySummary')}
        </Small>
      ) : null}
    </View>
  );

  return (
    <View
      testID="schedule-shifts-screen"
      style={{ flex: 1 }}
      className="bg-background"
    >
      <ScreenWash testID="schedule-screen-wash" kind="brand" />
      {/* Only the states that render no scroller keep the header stacked. */}
      {showContent || showCrossFamily ? null : header}

      {isLoading ? (
        <View style={{ flex: 1 }} className="items-center justify-center">
          <LoadingIndicator />
        </View>
      ) : null}

      {showUnavailable ? (
        // 0.3: `inline` — content-sized, not a self-centering flex:1 box —
        // is the pattern every other illustrated empty state in this app
        // uses. `default` centres against the FULL screen height, but React
        // Navigation overlays the tab bar rather than shrinking content for
        // it, so the box was centring ~80px low of the visible area.
        <View testID="schedule-shifts-unavailable" style={{ flex: 1 }}>
          <EmptyState
            variant="inline"
            title={t('shifts.screenTitle')}
            description={t('shifts.unavailable')}
          />
        </View>
      ) : null}

      {showQueryError ? (
        <View
          testID="schedule-shifts-error"
          style={{ flex: 1, paddingBottom: tabBarScrollPadding }}
        >
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
            variant="inline"
            image={illustrations.emptySchedule}
            title={emptyState.title}
            description={emptyState.description}
            action={emptyState.action}
            actionLabel={emptyState.actionLabel}
          />
        </View>
      ) : null}

      {showContent && calendarView === CALENDAR_VIEWS.AGENDA ? (
        <AgendaView
          listRef={agendaListRef}
          shifts={shifts}
          displayTimeZone={timeZone}
          timeOff={timeOff}
          householdTimeZone={timeZone}
          weekDates={weekDates}
          householdId={activeHousehold.householdId}
          uncoveredByDay={canViewCover ? uncoveredWeek.byDay : undefined}
          showUncoveredActions={canEditCover}
          focusUncoveredKey={scrollToUncoveredKey ?? focusUncoveredKey}
          commitments={commitmentsQuery.data ?? []}
          listHeader={header}
        />
      ) : null}

      {showContent && calendarView === CALENDAR_VIEWS.WEEK_RIBBON ? (
        <WeekRibbonView
          shifts={shifts}
          displayTimeZone={timeZone}
          weekStartsOn={weekStartsOn}
          timeOff={timeOff}
          householdTimeZone={timeZone}
          weekDates={weekDates}
          listHeader={gutterlessHeader}
        />
      ) : null}

      {showCrossFamily && activeHousehold.householdId ? (
        <CrossFamilyRhythmView
          households={activeHousehold.households}
          activeHouseholdId={activeHousehold.householdId}
          listHeader={gutterlessHeader}
        />
      ) : null}
    </View>
  );
}

/** @deprecated Prefer weekOffset + wallClockToUtcIso; kept for test imports. */
export { currentWeekRange } from '@/src/lib/wallClock';

export type { ScheduleShiftsScreenProps };
