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
 *
 * The week offset names the ANCHOR week: the hero band, the summary chip and
 * every empty/error/loading gate below speak about it, and the Week view
 * shows it. The Agenda scrolls continuously around it — further week pages
 * load above (`onStartReached`) and below (`onEndReached`) the anchor, each
 * its own query with its own loading/error state. The arrows still work in
 * Agenda as "jump to week": they move the anchor and the Agenda restarts
 * there.
 */

import type { FlashListRef } from '@shopify/flash-list';
import { MATERIALISATION_HORIZON_WEEKS } from '@steadily-nanny/shared-types';
import type { HouseholdClosure } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { uncoveredKey } from '@steadily-nanny/shared-types/uncoveredCare';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { Icon } from '@/lib/icons/iconWithClassName';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { InlineRetry } from '@/src/components/custom/InlineRetry';
import { PastMemberState } from '@/src/components/custom/PastMemberState';
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
  type AgendaWeek,
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
import {
  type AwaitingPattern,
  splitAwaiting,
  type UncoveredWindowDisplay,
  withCauses,
} from '@/src/domains/schedule/utils/uncoveredDisplay';
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
import { useSchedulePattern } from '@/src/hooks/queries/useSchedulePattern';
import {
  isShiftsRouteUnavailable,
  useShiftsRange,
} from '@/src/hooks/queries/useShiftsRange';
import { useShiftsRanges } from '@/src/hooks/queries/useShiftsRanges';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { useDeepLinkHousehold } from '@/src/hooks/useDeepLinkHousehold';
import { wallClockToUtcIso } from '@/src/lib/wallClock';
import { CALENDAR_VIEWS } from '@/src/store/calendarViewStore';
import { parseDateOnlyLocal } from '@/src/utils/parseDateOnlyLocal';

const MAX_WEEKS_BACK = 104;
const MAX_WEEKS_FORWARD = MATERIALISATION_HORIZON_WEEKS;

type CoverDays = {
  byDay: Record<string, UncoveredWindowDisplay[]>;
  awaitingByDay: Record<string, UncoveredWindowDisplay[]>;
  totalCount: number;
  awaitingCount: number;
};

const NO_COVER: CoverDays = {
  byDay: {},
  awaitingByDay: {},
  totalCount: 0,
  awaitingCount: 0,
};

/**
 * `byDay`/`totalCount` are the UNBOOKED pieces only — the summary count,
 * first-gap jump and empty-state fold all speak about those. The slices a
 * pending ask covers drop out (a partial ask leaves its edges unbooked);
 * pending-PATTERN slices go to `awaitingByDay` and render as Pending, while
 * a pending SHIFT's slice is shown by the shift itself. Display only: the
 * server alarm still counts the whole window (S1).
 */
function buildCoverDays(args: {
  dates: readonly string[];
  timeZone: string;
  commitments: readonly ChildCommitment[];
  shifts: readonly Shift[];
  closures: readonly HouseholdClosure[];
  pendingPattern: AwaitingPattern | null;
}): CoverDays {
  const shifts = [...args.shifts];
  const raw = computeUncoveredWeek({
    weekDates: args.dates,
    timezone: args.timeZone,
    commitments: args.commitments,
    shifts,
    closures: args.closures,
  });
  const result: CoverDays = {
    byDay: {},
    awaitingByDay: {},
    totalCount: 0,
    awaitingCount: 0,
  };
  for (const [date, windows] of Object.entries(raw.byDay)) {
    const { unbooked, awaiting } = splitAwaiting({
      windows,
      localDate: date,
      timezone: args.timeZone,
      commitments: args.commitments,
      shifts: shifts.filter(shift => shift.local_date === date),
      closures: args.closures,
      pendingPattern: args.pendingPattern,
    });
    result.byDay[date] = withCauses(unbooked, shifts);
    result.awaitingByDay[date] = withCauses(awaiting, shifts);
    result.totalCount += unbooked.length;
    result.awaitingCount += awaiting.length;
  }
  return result;
}

type ScheduleShiftsScreenProps = {
  /** When false, omits the back affordance (Schedule tab root). */
  showBack?: boolean;
  /** The usual-week banner(s), rendered in the scrolling header (the NOW
   * block in the Agenda, the top of the grid in Week/Rhythm). */
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
  // Week / Rhythm only (layout spec §7.2): the arrows page the one-week
  // grid. The Agenda always anchors on the CURRENT week and moves by
  // scrolling, so it reads offset 0 regardless.
  const [weekOffset, setWeekOffset] = useState(0);
  const isAgenda = calendarView === CALENDAR_VIEWS.AGENDA;
  const anchorOffset = isAgenda ? 0 : weekOffset;
  // Agenda week pages loaded before/after the current week.
  const [agendaPages, setAgendaPages] = useState({ before: 0, after: 0 });
  const [nowRequest, setNowRequest] = useState(0);
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
    () => addWeeks(currentWeekStartISO, anchorOffset),
    [currentWeekStartISO, anchorOffset]
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
  // A pending weekly ask materialises no shifts until accepted, so its days
  // are the only way to tell "asked, waiting" from "nobody asked".
  const pendingPatternQuery = useSchedulePattern(
    canViewCover && pattern?.status === 'pending' ? pattern.id : null
  );
  // P11: apricot means "on the clock", so the rows need the clock, not just
  // the calendar. One query for the whole screen — the CURRENT week, since
  // that's the only week a running entry can live in, regardless of which
  // week the reader has paged to.
  const weekTimeEntries = useWeekTimeEntries(
    activeHousehold.householdId,
    currentWeekStartISO
  );
  const runningShiftIds = useMemo(
    () =>
      new Set(
        (weekTimeEntries.data ?? [])
          .filter(e => e.status === 'running' && e.shift_id)
          .map(e => e.shift_id as string)
      ),
    [weekTimeEntries.data]
  );
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
        patternLoading ||
        pendingPatternQuery.isLoading));
  // Pattern B: the same reads, FAILED. `?? []` turns a failed cover input
  // into "zero uncovered windows / nobody away", which `showEmpty` then
  // reports as "no shifts yet, you're set up". We do not know that. Withhold
  // the claim and offer the read again instead.
  // `carersQuery` is deliberately NOT here: it only supplies a first name in
  // the lead sentence, never a coverage claim, so failing it must not blank
  // the week. It IS refetched by the retry below, since that is free.
  const coverInputsFailed =
    timeOffQuery.isError ||
    (canViewCover &&
      (commitmentsQuery.isError ||
        closuresQuery.isError ||
        pendingPatternQuery.isError));
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
  const pendingPattern = pendingPatternQuery.data ?? null;
  const uncoveredWeek = useMemo(
    () =>
      canViewCover
        ? buildCoverDays({
            dates: weekDates,
            timeZone,
            commitments: commitmentsQuery.data ?? [],
            shifts,
            closures: closuresQuery.data ?? [],
            pendingPattern,
          })
        : NO_COVER,
    [
      canViewCover,
      weekDates,
      timeZone,
      commitmentsQuery.data,
      shifts,
      closuresQuery.data,
      pendingPattern,
    ]
  );

  // ---- Continuous Agenda: week pages around the anchor week ----
  const extraPages = useMemo(() => {
    const pages: { weekStart: string; from: string; to: string }[] = [];
    for (let k = -agendaPages.before; k <= agendaPages.after; k++) {
      if (k === 0) continue;
      const pageStart = addWeeks(weekStartISO, k);
      pages.push({
        weekStart: pageStart,
        from: wallClockToUtcIso(pageStart, '00:00', timeZone),
        to: wallClockToUtcIso(addWeeks(pageStart, 1), '00:00', timeZone),
      });
    }
    return pages;
  }, [agendaPages.before, agendaPages.after, weekStartISO, timeZone]);
  const activeExtraPages = isAgenda ? extraPages : [];
  const extraQueries = useShiftsRanges(
    activeHousehold.householdId,
    activeExtraPages
  );
  // The anchor week comes from `shiftsQuery`; the screen gates below only
  // mount the Agenda once it has loaded, so it is always `ready` here.
  const agendaWeeks: AgendaWeek[] = useMemo(() => {
    const extra = activeExtraPages.map((page, i): AgendaWeek => {
      const query = extraQueries[i];
      return {
        weekStart: page.weekStart,
        dates: getWeekDates(page.weekStart),
        // `data` decides, not `isLoading`: a query that hasn't run yet has
        // neither, and must not render as a loaded, empty week.
        status: query?.data ? 'ready' : query?.isError ? 'error' : 'loading',
        onRetry: () => {
          void query?.refetch();
        },
      };
    });
    return [
      ...extra.filter(week => week.weekStart < weekStartISO),
      { weekStart: weekStartISO, dates: weekDates, status: 'ready' },
      ...extra.filter(week => week.weekStart > weekStartISO),
    ];
  }, [activeExtraPages, extraQueries, weekStartISO, weekDates]);
  const agendaShifts = useMemo(() => {
    const byId = new Map(shifts.map(shift => [shift.id, shift]));
    for (const query of extraQueries) {
      for (const shift of query.data ?? []) {
        byId.set(shift.id, shift);
      }
    }
    return [...byId.values()];
  }, [shifts, extraQueries]);
  const agendaCover = useMemo(() => {
    if (!canViewCover || activeExtraPages.length === 0) {
      return uncoveredWeek;
    }
    // ponytail: recomputes every loaded week on each page load — fine for
    // the tens of weeks a reader scrolls; memoise per week if it ever shows.
    return buildCoverDays({
      dates: agendaWeeks
        .filter(week => week.status === 'ready')
        .flatMap(week => week.dates),
      timeZone,
      commitments: commitmentsQuery.data ?? [],
      shifts: agendaShifts,
      closures: closuresQuery.data ?? [],
      pendingPattern,
    });
  }, [
    canViewCover,
    activeExtraPages.length,
    uncoveredWeek,
    agendaWeeks,
    timeZone,
    commitmentsQuery.data,
    agendaShifts,
    closuresQuery.data,
    pendingPattern,
  ]);
  const firstPage = agendaWeeks[0];
  const lastPage = agendaWeeks[agendaWeeks.length - 1];
  const canLoadEarlier =
    agendaPages.before < MAX_WEEKS_BACK && firstPage?.status === 'ready';
  const canLoadLater =
    agendaPages.after < MAX_WEEKS_FORWARD && lastPage?.status === 'ready';
  const loadEarlier = useCallback(() => {
    setAgendaPages(p => ({ ...p, before: p.before + 1 }));
  }, []);
  const loadLater = useCallback(() => {
    setAgendaPages(p => ({ ...p, after: p.after + 1 }));
  }, []);

  const focusUncoveredKey = useMemo(() => {
    if (!arrivalLocalDate || !focusUncovered) {
      return null;
    }
    const first = agendaCover.byDay[arrivalLocalDate]?.[0];
    return first ? uncoveredKey(first) : null;
  }, [arrivalLocalDate, focusUncovered, agendaCover.byDay]);

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
    // The Agenda stays anchored on the current week; load out to the
    // target week so its gap is in the list to jump to.
    setAgendaPages(p =>
      offset < -p.before
        ? { ...p, before: Math.min(-offset, MAX_WEEKS_BACK) }
        : offset > p.after
          ? { ...p, after: Math.min(offset, MAX_WEEKS_FORWARD) }
          : p
    );
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
  // Awaiting windows are not counted, but they still need the agenda mounted
  // to show their Pending rows — same P0 contradiction otherwise.
  const hasAwaitingForViewer = canViewCover && uncoveredWeek.awaitingCount > 0;

  const showEmpty =
    !isLoading &&
    !showUnavailable &&
    !showQueryError &&
    !coverInputsFailed &&
    shifts.length === 0 &&
    !weekHasAway &&
    !hasUncoveredForViewer &&
    !hasAwaitingForViewer;
  const showContent =
    !isLoading &&
    !showUnavailable &&
    !showQueryError &&
    (shifts.length > 0 ||
      weekHasAway ||
      hasUncoveredForViewer ||
      hasAwaitingForViewer);
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
        // The pinned bar above already carries the top inset.
        paddingTop: 8,
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
          {/* The read-only reminder, layer 2 of the past-member design (see
              `ScreenHeader`'s `readOnly` docs): the explanation lives once,
              on Today's pinned card, and every other tab showing household
              data carries this one line. Hiding the write affordances alone
              leaves nothing on screen saying WHY they are gone.
              This band predates `ScreenHeader` and is still hand-rolled —
              it stacks a figure and a per-carer note the band's one-anchor
              cap does not hold as-is — so it reproduces `ScreenHeader`'s
              exact `"Read-only · {context}"` line rather than importing it.
              Fold this into `ScreenHeader` when the band is finally
              converted; the testID swap mirrors it deliberately. */}
          <Small
            testID={
              onboarding.isPastMember
                ? 'schedule-header-read-only'
                : 'schedule-lead'
            }
            className="text-muted-strong"
          >
            {onboarding.isPastMember
              ? `${tCommon('readOnlyBadge')} · ${lead}`
              : lead}
          </Small>
          {/* The week range is not repeated here — `WeekNavHeader` below
              already owns and renders that exact string. */}
          {/* Suppressed for a past member. "0h scheduled this week" is a
              FACTUAL ASSERTION about a household she is no longer in, and it
              is not even derived from a read the server served her — the
              shifts query is membership-gated, so the zero comes from an
              empty default, not from an answer. CLAUDE.md's rule about
              ungated queries stating facts is exactly this shape. The
              read-only line above already carries the honest version. */}
          {onboarding.isPastMember ? null : (
            <Figure28 testID="schedule-week-total" weight="semibold">
              {t('shifts.weekTotal', {
                duration: formatDuration(weekTotalMinutes),
              })}
            </Figure28>
          )}
          {!isNannyVoice && carerList.length > 1 ? (
            <Small
              testID="schedule-week-total-note"
              className="text-muted-strong"
            >
              {t('shifts.weekTotalAllCarers')}
            </Small>
          ) : null}
        </View>
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
      {patternBanner ?? null}
      {coverInputsFailed ? (
        <InlineRetry
          testID="schedule-cover-retry"
          message={t('cover.loadFailed')}
          onRetry={() => {
            void commitmentsQuery.refetch();
            void closuresQuery.refetch();
            void pendingPatternQuery.refetch();
            void timeOffQuery.refetch();
            void carersQuery.refetch();
          }}
        />
      ) : null}
    </View>
  );
  // Pinned above every scroller (and above the stacked header in the
  // non-scrolling states). Layout spec §9: in the Agenda ONE row, in fixed
  // order — switcher (flex-1) · Today · + · gear (~78pt). Week / Rhythm drop
  // Today and add the week nav as row 2 (its label matches the one week on
  // screen by construction). The Agenda has NO pinned week label — its
  // in-list week dividers name the rows beside them. No gap count here
  // either: Today's coverage surface counts gaps, and on this screen the
  // amber cards are the count.
  const controlsBar = (
    <View
      testID="schedule-controls-bar"
      style={{
        gap: 8,
        paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
        paddingTop: SCREEN_CONTENT_STYLE.padding,
        paddingBottom: 8,
      }}
    >
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <CalendarViewSwitcher
            value={calendarView}
            onChange={setCalendarView}
          />
        </View>
        {isAgenda ? (
          // Always rendered (never toggled by scroll position), so the
          // switcher never changes width mid-scroll.
          <Button
            testID="schedule-jump-today"
            variant="ghost"
            size="sm"
            onPress={() => setNowRequest(n => n + 1)}
          >
            {t('shifts.jumpToday')}
          </Button>
        ) : null}
        {canAddExtra ? (
          // Icon-only: four items don't fit at 375pt with a text label. The
          // full phrase is its accessible name.
          <Button
            testID="schedule-shifts-add-extra"
            variant="secondary"
            size="icon"
            accessibilityLabel={t('shifts.addExtra')}
            onPress={() =>
              router.push('/(private)/schedule/shifts/extra' as Href)
            }
          >
            <Icon icon={Plus} size={20} className="text-foreground" />
          </Button>
        ) : null}
        {/* Tab-root only: the pushed variant has its own back button. */}
        {showBack ? null : <SettingsHeaderButton />}
      </View>
      {isAgenda ? null : (
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
      )}
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
      {controlsBar}
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
        onboarding.isPastMember ? (
          // Every branch of `emptyState` above is written at someone still
          // employed — "No shifts yet" is an active nanny's quiet week, and
          // the pattern-pending copy promises a week somebody is still going
          // to build. Layer 4 replaces ONLY this empty state: a past member
          // whose week still holds shifts keeps the list, because that list
          // IS the read-only record the design preserves, and the header
          // chip already says it takes no writes.
          <PastMemberState
            testID="schedule-past-member"
            // Cross-namespace on purpose: `schedule` has no `pastMember`
            // pair yet, and this is the canonical wording. Swap to
            // `schedule:pastMember.*` the moment it lands — the description
            // still names time off, which is not what went quiet here.
            title={t('timeOff:pastMember.title')}
            description={t('timeOff:pastMember.description')}
          />
        ) : (
          <View testID="schedule-shifts-empty" style={{ flex: 1 }}>
            <EmptyState
              variant="inline"
              image={illustrations.emptySchedule}
              title={emptyState.title}
              description={emptyState.description}
            />
          </View>
        )
      ) : null}

      {showContent && calendarView === CALENDAR_VIEWS.AGENDA ? (
        <AgendaView
          listRef={agendaListRef}
          shifts={agendaShifts}
          weeks={agendaWeeks}
          heroWeekStart={weekStartISO}
          onLoadEarlier={canLoadEarlier ? loadEarlier : undefined}
          onLoadLater={canLoadLater ? loadLater : undefined}
          displayTimeZone={timeZone}
          timeOff={timeOff}
          householdTimeZone={timeZone}
          householdId={activeHousehold.householdId}
          uncoveredByDay={canViewCover ? agendaCover.byDay : undefined}
          awaitingByDay={canViewCover ? agendaCover.awaitingByDay : undefined}
          showUncoveredActions={canEditCover}
          focusUncoveredKey={scrollToUncoveredKey ?? focusUncoveredKey}
          nowRequest={nowRequest}
          commitments={canViewCover ? commitmentsQuery.data : undefined}
          pendingPattern={pendingPattern}
          listHeader={header}
          runningShiftIds={runningShiftIds}
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
          awaitingByDay={canViewCover ? uncoveredWeek.awaitingByDay : undefined}
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
