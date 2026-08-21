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
import { InlineRetry } from '@/src/components/custom/InlineRetry';
import { BackButton } from '@/src/components/ui/back-button';
import { Button } from '@/src/components/ui/button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { ScreenWash } from '@/src/components/ui/screen-wash';
import { SettingsHeaderButton } from '@/src/components/ui/settings-header-button';
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
import { carerDayBreakdown } from '@/src/domains/schedule/utils/carerDayBreakdown';
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
import { useDeepLinkHousehold } from '@/src/hooks/useDeepLinkHousehold';
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
  // Pattern A NAVIGATION-TIME: a push that lands on this TAB carrying a
  // `householdId` moves the switcher (announced by the hook's toast) — a tab
  // can only show one household, so opening family A's week for a link about
  // family B would be the lie. A target she isn't in gets no switch and the
  // not-a-member state below.
  const { notMember: deepLinkNotMember } = useDeepLinkHousehold(
    params.householdId
  );
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
    // `timeOff` feeds `weekHasAway` and `closures` feeds `computeUncoveredWeek`
    // — both read as `?? []`, so a PENDING read is an empty week to every
    // predicate below. Wait for them rather than let the gap render as a fact.
    timeOffQuery.isLoading ||
    (canViewCover &&
      (commitmentsQuery.isLoading ||
        closuresQuery.isLoading ||
        patternLoading));
  // Pattern B: the same reads, FAILED. `?? []` turns a failed cover input
  // into "zero uncovered windows / nobody away", which `showEmpty` then
  // reports as "no shifts yet, you're set up". We do not know that. Withhold
  // the claim and offer the read again instead.
  // `carersQuery` is deliberately NOT here: it only supplies a first name in
  // the lead sentence, never a coverage claim, so failing it must not blank
  // the week. It IS refetched by the retry below, since that is free.
  const coverInputsFailed =
    timeOffQuery.isError ||
    (canViewCover && (commitmentsQuery.isError || closuresQuery.isError));
  // 404 "route not built yet" stays a calm empty — every other query error
  // must offer retry (network blip ≠ "check back soon").
  const routeUnavailable =
    shiftsQuery.isError && isShiftsRouteUnavailable(shiftsQuery.error);
  const showQueryError = shiftsQuery.isError && !routeUnavailable;
  const showUnavailable = routeUnavailable;

  const shifts = shiftsQuery.data ?? [];
  // The week-total anchor (docs/design/01-LAWS.md, "the highest-value addition on
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
  // S7: naming only the first carer while counting every carer's shifts was
  // a wrong factual claim the moment a second nanny worked days of her own
  // (docs/AS-BUILT-SCHEDULE.md §6 S7). Two or more active carers get their
  // own per-carer breakdown instead of one name standing in for the total.
  const carerList = carersQuery.data ?? [];
  const perCarerLead = useMemo(
    () =>
      carerList.length > 1
        ? carerDayBreakdown(
            carerList.map(carer => ({
              userId: carer.user_id,
              name: resolveCarerName(carer, t('build.carerFallbackName')),
            })),
            coveringShifts
          )
            .map(entry =>
              t('week.leadPerCarer', { name: entry.name, count: entry.days })
            )
            .join(' · ')
        : null,
    [carerList, coveringShifts, t]
  );
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
  // Short-circuits every content/empty/loading branch below: she is not in
  // the household this link names, so there is no week here to show her.
  // Placed after the last hook call so the hook order never varies.
  if (deepLinkNotMember) {
    return (
      <View testID="schedule-deep-link-not-member" style={{ flex: 1 }}>
        <ErrorState
          variant="notFound"
          title={tCommon('deepLink.notMember.title')}
          message={tCommon('deepLink.notMember.message')}
          secondaryLabel={tCommon('deepLink.notMember.action')}
          onSecondaryAction={() => {
            router.replace('/(private)/(tabs)/home' as Href);
          }}
        />
      </View>
    );
  }

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
    !coverInputsFailed &&
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
  // Rule H: the hero band carries at most H1 + one context line + one
  // anchor. `lead` IS that one context line — it names the carer and counts
  // the shifts, which is more than the generic `shifts.*Subtitle` ever said,
  // so the subtitle was dropped rather than stacked alongside it.
  const lead = isNannyVoice
    ? t('lead.nanny', { count: coveringShifts.length })
    : perCarerLead !== null
      ? perCarerLead
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
          // No CTA. It used to offer "Build the usual week" here, but it
          // lived inside the `showEmpty` branch — which goes false the
          // moment `uncoveredWeek.totalCount > 0`, i.e. the moment the
          // parent types any care hours. The offer appeared once and then
          // disappeared. `SchedulePatternBanner` above now carries that act
          // in every pattern state, so a copy here is the same act offered
          // twice, one of them conditionally.
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
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <H1>{heading}</H1>
          <Small testID="schedule-lead" className="text-muted-strong">
            {lead}
          </Small>
          {/* The week range is not repeated here — `WeekNavHeader` below
              already owns and renders that exact string. */}
          <Figure28 testID="schedule-week-total" weight="semibold">
            {t('shifts.weekTotal', {
              duration: formatDuration(weekTotalMinutes),
            })}
          </Figure28>
        </View>
        {/* Tab-root only: Settings is reached from the header now (WP-C),
            and the pushed variant above already has its own back button. */}
        {showBack ? null : <SettingsHeaderButton />}
      </View>
      {/* S11: a nanny had no pattern-level surface at all — this is the one
          link into her read-only `NannyUsualWeekScreen` from her Schedule
          tab root. Parent/helper reach the equivalent screen via
          `SchedulePatternBanner` instead, so this is nanny-only. */}
      {isNannyVoice ? (
        <Button
          testID="schedule-shifts-usual-week-link"
          variant="ghost"
          size="sm"
          className="self-start"
          onPress={() =>
            router.push(
              `/(private)/schedule/usual-week?householdId=${activeHousehold.householdId}` as Href
            )
          }
        >
          {t('shifts.usualWeekLink')}
        </Button>
      ) : null}
      {patternBanner}
      {coverInputsFailed ? (
        <InlineRetry
          testID="schedule-cover-retry"
          message={t('cover.loadFailed')}
          onRetry={() => {
            void commitmentsQuery.refetch();
            void closuresQuery.refetch();
            void timeOffQuery.refetch();
            void carersQuery.refetch();
          }}
        />
      ) : null}
      {/* Rule H: the only actionable fact on the screen, so it gets a real
          affordance — a bordered chip, not a bare warning-coloured caption —
          and it is never suppressed by the pattern banner above. The banner
          says "you haven't set the weekly hours"; this says "N windows this
          week have nobody booked" — different facts, and the no-pattern
          state is exactly the one with the MOST gaps to report. */}
      {canViewCover && uncoveredWeek.totalCount > 0 ? (
        <Pressable
          testID="schedule-cover-week-summary"
          accessibilityRole="button"
          className="self-start flex-row items-center rounded-row bg-pill-warning px-4 py-2.5"
          style={{ minHeight: spacing.minTouchTarget }}
          onPress={() => {
            if (firstUncoveredKey) {
              setScrollToUncoveredKey(firstUncoveredKey);
            }
            if (calendarView !== CALENDAR_VIEWS.AGENDA) {
              setCalendarView(CALENDAR_VIEWS.AGENDA);
            }
          }}
        >
          <Small className="text-warning-ink" weight="medium">
            {t('cover.weekSummaryTitle', { count: uncoveredWeek.totalCount })}
          </Small>
        </Pressable>
      ) : null}
      {/* A 16px gap (double the 8px used above) separates the hero band from
          week navigation + view switching — the header visibly ends before
          this section begins (Rule H). */}
      <View style={{ gap: 8, marginTop: 8 }}>
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
        {canAddExtra ? (
          // Was a `Small semibold text-primary` pressable beside the H1 —
          // the highest-status slot on the screen, holding the lesser of the
          // two acts a parent takes here (the greater one is the usual week,
          // which the banner above owns). `docs/design/screens-schedule.md`
          // §2 puts this in the FOOTER — it sits at the end of the shared
          // header instead because a real list footer needs a `listFooter`
          // prop on AgendaView / WeekRibbonView / CrossFamilyRhythmView, and
          // the three of them own their own scrollers. Move it when that
          // prop exists.
          <Button
            testID="schedule-shifts-add-extra"
            variant="secondary"
            onPress={() =>
              router.push('/(private)/schedule/shifts/extra' as Href)
            }
          >
            {t('shifts.addExtra')}
          </Button>
        ) : null}
      </View>
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
          {isNannyVoice
            ? t('shifts.awaySummaryNanny')
            : t('shifts.awaySummary')}
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
          uncoveredByDay={canViewCover ? uncoveredWeek.byDay : undefined}
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
