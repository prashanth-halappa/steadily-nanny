/**
 * @module domains/timesheet/components/HoursScreen
 *
 * The Hours tab — role-aware. A nanny sees her own week's entries and
 * total; a parent sees the week for their carer plus Approve/Query. Role
 * comes from `useIsOnboarded()` (server-derived), never a local flag — see
 * that hook's header comment for why that distinction is ship-blocking.
 * "Hours only — no payments here."
 *
 * D15: week navigation lives HERE, not in the child views. `weekOffset` is a
 * small integer (0 = current week, -1 = last week, ...) rather than an
 * absolute date, per `addWeeks`'s header comment — it's reconciled against
 * "now" on every render instead of drifting from it. Every approved week
 * used to become unreachable the following Monday because nothing above
 * `WeekTotal` ever passed it the nav callbacks it already supported; both
 * role views receive the same offset state so neither role regresses.
 *
 * Deep links (`hoursHref` for timesheet_submitted / timesheet_queried) pass
 * `weekStart` via search params. That absolute week start is converted to
 * the matching offset from the household's current week so a push about a week
 * three weeks back opens THAT week, not weekOffset=0. Schedule-route params
 * are not read here.
 *
 * `weekStart` is one-shot: applied into local week state, then cleared from
 * the route via `router.setParams`. The Hours tab does not unmount on blur,
 * so a sticky search param would otherwise reopen that old week on every
 * later visit. Blur resets local paging so returning to the tab lands on the
 * current week; a fresh push can set `weekStart` again and win.
 *
 * `breakdown=1` (from a payment's "For the week" row) rides the same
 * one-shot discipline for the same reason — left on the route it would
 * re-open the earnings breakdown on every later visit to this tab. It is
 * consumed into a monotonically increasing nonce handed to whichever week
 * view is rendered; the breakdown sheet's open state stays where it already
 * lived, inside that view.
 *
 * Wave B: the household shown here comes from `useActiveHousehold`, not
 * `useIsOnboarded().householdId` — a nanny in multiple households needs the
 * one she's currently switched to, and `useIsOnboarded` only ever resolves
 * the FIRST membership it finds. Role (`onboarding.role`/`.status`) still
 * comes from `useIsOnboarded` — that predicate is unaffected by which
 * household is active.
 */

import { HOUSEHOLD_STATES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { EmptyState } from '@/src/components/ui/empty-state';
import { ScreenWash } from '@/src/components/ui/screen-wash';
import { H1 } from '@/src/components/ui/typography';
import {
  canViewParentSchedule,
  isParentEditorRole,
} from '@/src/domains/setup/types';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import {
  addWeeks,
  DEFAULT_WEEK_STARTS_ON,
  formatWeekRangeLabel,
  getWeekDates,
  getWeekStartISO,
  weeksBetween,
} from '../utils/week';
import { HoursWeekSkeleton } from './HoursWeekSkeleton';
import { NannyWeekView } from './NannyWeekView';
import { ParentWeekView } from './ParentWeekView';

// Neither `/time-entries` nor `/timesheets` bounds how far back `week_start`
// can be requested — the API will happily answer for a week from before the
// household even existed, just with empty data. Bound it on this side so
// nobody can page back indefinitely into empty years looking for a bug that
// isn't there. Two years is generous relative to how long any household is
// likely to have been tracking hours in this app; revisit if that stops
// being true.
const MAX_WEEKS_BACK = 104;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeSearchParam(
  value: string | string[] | undefined | null
): string | undefined {
  // Expo Router may surface a cleared param as `null` (or, on older builds,
  // the literal string "undefined") — treat those as absent.
  if (value == null || value === 'undefined' || value === 'null') {
    return undefined;
  }
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Clamp a deep-link / nav offset into the Hours history window. */
function clampWeekOffset(offset: number): number {
  return Math.max(-MAX_WEEKS_BACK, Math.min(0, offset));
}

/**
 * Absolute week start from a push → weekOffset relative to the household's
 * current week. Invalid / missing / future dates fall back to 0.
 */
function weekOffsetFromSearchParam(
  weekStartParam: string | undefined,
  currentWeekStartISO: string
): number {
  if (typeof weekStartParam !== 'string' || !ISO_DATE_RE.test(weekStartParam)) {
    return 0;
  }
  const offset = weeksBetween(currentWeekStartISO, weekStartParam);
  if (!Number.isFinite(offset)) return 0;
  return clampWeekOffset(offset);
}

export function HoursScreen() {
  const { t } = useTranslation('hours');
  const router = useRouter();
  // Same tab-bar dead-zone fix as Settings (BUG1) — the floating tab bar
  // overlays this screen's content instead of reserving its own layout
  // space, so a fixed paddingBottom is not safe-area-aware. Threaded into
  // both role views' FlashLists below, not just the empty-role ScrollView.
  const tabBarScrollPadding = useTabBarScrollPadding();
  const { refreshControl } = usePullToRefresh();
  const onboarding = useIsOnboarded();
  // `useActiveHousehold` already fetches households internally (a cache hit,
  // not a second request) — this is the switcher-aware household, which for
  // a nanny in multiple households may differ from `onboarding.householdId`.
  const activeHousehold = useActiveHousehold();
  const household = activeHousehold.household;
  // The week boundary is a HOUSEHOLD question on both axes — its timezone
  // AND its `week_starts_on` — never the device's zone and never a
  // hardcoded Monday (see utils/week.ts's header comment). Both fall back
  // only for the brief window before the household has loaded (the loading
  // branch below returns before either value is ever shown).
  const timezone = household?.timezone ?? 'UTC';
  const weekStartsOn = household?.week_starts_on ?? DEFAULT_WEEK_STARTS_ON;

  // Only `weekStart` is consumed from the hours deep link. `householdId` /
  // `timesheetId` may be on the URL (from `hoursHref`) but household comes
  // from `useActiveHousehold`; timesheet is resolved by week query.
  const searchParams = useLocalSearchParams<{
    weekStart?: string | string[];
    breakdown?: string | string[];
  }>();
  const weekStartFromRoute = normalizeSearchParam(searchParams.weekStart);
  const wantsBreakdown = normalizeSearchParam(searchParams.breakdown) === '1';
  const validWeekStart =
    typeof weekStartFromRoute === 'string' &&
    ISO_DATE_RE.test(weekStartFromRoute)
      ? weekStartFromRoute
      : undefined;

  // A single "now" snapshot per screen render pass, not a live ticker — the
  // Hours screen shows history, not the Today card's live timer. Recomputed
  // whenever the screen remounts (tab focus), which is close enough for a
  // "so far today" figure that isn't the headline feature here.
  const nowMs = useMemo(() => Date.now(), []);
  const currentWeekStartISO = useMemo(
    () => getWeekStartISO(new Date(), timezone, weekStartsOn),
    [timezone, weekStartsOn]
  );
  // Deep-link absolute week start → offset. Absent/invalid → 0 (current week).
  // Used for the first paint before the consume effect copies into local
  // state, and as the baseline for prev/next until the user pages.
  const routeWeekOffset = useMemo(
    () => weekOffsetFromSearchParam(validWeekStart, currentWeekStartISO),
    [validWeekStart, currentWeekStartISO]
  );
  // null = follow the route offset (or current week once the param is gone);
  // non-null = deep-link consume and/or user paging with prev/next.
  const [userWeekOffset, setUserWeekOffset] = useState<number | null>(null);
  // 0 = never asked. A counter rather than a boolean: a SECOND payment
  // opened later must re-open the breakdown, and a flag already sitting at
  // `true` would swallow that silently.
  const [openBreakdownSignal, setOpenBreakdownSignal] = useState(0);

  // One-shot: apply a valid weekStart into local state, then clear it from the
  // route so a later Hours visit (tab stays mounted) cannot reopen it.
  // `breakdown` is consumed and cleared in the same breath, for the same
  // reason — see the module header.
  // Do not reset userWeekOffset when the param disappears — that would jump
  // back to the current week immediately after the deep link lands.
  useEffect(() => {
    if (!validWeekStart && !wantsBreakdown) return;
    if (validWeekStart) {
      setUserWeekOffset(
        weekOffsetFromSearchParam(validWeekStart, currentWeekStartISO)
      );
    }
    if (wantsBreakdown) setOpenBreakdownSignal(signal => signal + 1);
    router.setParams({ weekStart: undefined, breakdown: undefined });
  }, [validWeekStart, wantsBreakdown, currentWeekStartISO, router]);

  // Leaving the tab drops local paging so the next focus (with no weekStart)
  // lands on the current week. A new push can set weekStart again and the
  // consume effect above will re-apply it.
  useFocusEffect(
    useCallback(() => {
      return () => {
        setUserWeekOffset(null);
      };
    }, [])
  );

  const weekOffset = userWeekOffset ?? routeWeekOffset;
  const weekStartISO = useMemo(
    () => addWeeks(currentWeekStartISO, weekOffset),
    [currentWeekStartISO, weekOffset]
  );
  const weekDates = useMemo(() => getWeekDates(weekStartISO), [weekStartISO]);
  const weekRangeLabel = useMemo(
    () => formatWeekRangeLabel(weekDates),
    [weekDates]
  );
  // Clamped at `-MAX_WEEKS_BACK` — see that constant's comment.
  const handlePreviousWeek = useCallback(() => {
    setUserWeekOffset(offset => {
      const current = offset ?? routeWeekOffset;
      const next = clampWeekOffset(current - 1);
      // Same offset → keep prior state (including null) so a no-op press at
      // the history floor does not force a re-render / refetch.
      return next === current ? offset : next;
    });
  }, [routeWeekOffset]);
  // Clamped at 0 — there are no hours yet for a future week, and an empty
  // future week reads as a bug rather than as "nothing to show".
  const handleNextWeek = useCallback(() => {
    setUserWeekOffset(offset => {
      const current = offset ?? routeWeekOffset;
      const next = clampWeekOffset(current + 1);
      // Critical: at the current-week ceiling, `null ?? 0` then +1 clamps back
      // to 0. Writing `0` over `null` would re-render and re-query the same
      // week even though the displayed week did not move.
      return next === current ? offset : next;
    });
  }, [routeWeekOffset]);
  // A household she was REMOVED from: the API still serves her the hours and
  // pay she accrued there, and refuses every write. The screen must say the
  // same thing — offering a write it knows will 403 is a lie.
  const isReadOnly = onboarding.isPastMember;

  const isNextWeekDisabled = weekOffset >= 0;
  const isPreviousWeekDisabled = weekOffset <= -MAX_WEEKS_BACK;

  // Daylight v2: the title and the week label are derived locally and paint
  // on the first frame — only the figure and the day rows are ever a
  // skeleton. The `LoadingIndicator` this replaces blanked the whole tab,
  // title included, on every household/role resolution.
  if (onboarding.status === 'loading' || activeHousehold.isLoading) {
    return (
      <View testID="hours-screen" className="flex-1 bg-background">
        <ScreenWash kind="brand" />
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={{
            ...SCREEN_CONTENT_STYLE,
            paddingBottom: tabBarScrollPadding,
          }}
        >
          <HoursWeekSkeleton
            weekRangeLabel={weekRangeLabel}
            onPreviousWeek={handlePreviousWeek}
            onNextWeek={handleNextWeek}
            isPreviousDisabled={isPreviousWeekDisabled}
            isNextDisabled={isNextWeekDisabled}
          />
        </ScrollView>
      </View>
    );
  }

  // D-36 §S6 item 4: the draft is HERS — nothing can insert a time entry
  // into a draft household (093), so this is a true empty state, never "the
  // family is still setting up" (there is no family yet).
  if (household?.state === HOUSEHOLD_STATES.DRAFT) {
    return (
      <View testID="hours-screen" className="flex-1 bg-background">
        <ScreenWash kind="brand" />
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={{
            ...SCREEN_CONTENT_STYLE,
            paddingBottom: tabBarScrollPadding,
          }}
        >
          <View testID="hours-draft-empty">
            <EmptyState
              variant="inline"
              title={t('draftEmpty.title')}
              description={t('draftEmpty.description')}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  if (!activeHousehold.householdId || !onboarding.role) {
    return (
      <View testID="hours-screen" className="flex-1 bg-background">
        <ScreenWash kind="brand" />
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={{
            ...SCREEN_CONTENT_STYLE,
            paddingBottom: tabBarScrollPadding,
          }}
        >
          <H1>{t('title')}</H1>
        </ScrollView>
      </View>
    );
  }

  return (
    <View testID="hours-screen" className="flex-1 bg-background">
      {/* The statement sits ON the wash — which is why the title moved into
          the scrollable content below instead of a fixed opaque header row
          above it (screens-hours.md §2). */}
      <ScreenWash kind="brand" />
      {/* Absolute week start currently shown — Maestro deep-link regression (weekStart one-shot). */}
      <View
        testID={`hours-active-week-${weekStartISO}`}
        collapsable={false}
        style={{ width: 1, height: 1 }}
        accessible={false}
        importantForAccessibility="no"
      />
      {canViewParentSchedule(onboarding.role) ? (
        <ParentWeekView
          householdId={activeHousehold.householdId}
          weekStartISO={weekStartISO}
          weekDates={weekDates}
          weekRangeLabel={weekRangeLabel}
          nowMs={nowMs}
          timeZone={timezone}
          onPreviousWeek={handlePreviousWeek}
          onNextWeek={handleNextWeek}
          isNextWeekDisabled={isNextWeekDisabled}
          isPreviousWeekDisabled={isPreviousWeekDisabled}
          isPastMember={isReadOnly}
          readOnly={!isParentEditorRole(onboarding.role) || isReadOnly}
          openBreakdownSignal={openBreakdownSignal}
        />
      ) : (
        <NannyWeekView
          householdId={activeHousehold.householdId}
          weekStartISO={weekStartISO}
          weekDates={weekDates}
          weekRangeLabel={weekRangeLabel}
          nowMs={nowMs}
          timeZone={timezone}
          onPreviousWeek={handlePreviousWeek}
          onNextWeek={handleNextWeek}
          isNextWeekDisabled={isNextWeekDisabled}
          isPreviousWeekDisabled={isPreviousWeekDisabled}
          isPastMember={isReadOnly}
          readOnly={isReadOnly}
          openBreakdownSignal={openBreakdownSignal}
        />
      )}
    </View>
  );
}
