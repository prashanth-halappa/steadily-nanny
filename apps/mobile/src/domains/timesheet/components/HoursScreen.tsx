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
 * Wave B: the household shown here comes from `useActiveHousehold`, not
 * `useIsOnboarded().householdId` — a nanny in multiple households needs the
 * one she's currently switched to, and `useIsOnboarded` only ever resolves
 * the FIRST membership it finds. Role (`onboarding.role`/`.status`) still
 * comes from `useIsOnboarded` — that predicate is unaffected by which
 * household is active.
 */
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, H1 } from '@/src/components/ui/typography';
import {
  canViewParentSchedule,
  isParentEditorRole,
} from '@/src/domains/setup/types';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import {
  addWeeks,
  formatWeekRangeLabel,
  getWeekDates,
  getWeekStartISO,
} from '../utils/week';
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

export function HoursScreen() {
  const { t } = useTranslation('hours');
  const { t: tSettings } = useTranslation('settings');
  const onboarding = useIsOnboarded();
  // `useActiveHousehold` already fetches households internally (a cache hit,
  // not a second request) — this is the switcher-aware household, which for
  // a nanny in multiple households may differ from `onboarding.householdId`.
  const activeHousehold = useActiveHousehold();
  const household = activeHousehold.household;
  // The week boundary is a HOUSEHOLD-timezone question, never the device's
  // — see utils/week.ts's header comment. Falls back to UTC only for the
  // brief window before the household has loaded (the loading branch below
  // returns before this value is ever shown).
  const timezone = household?.timezone ?? 'UTC';

  // A single "now" snapshot per screen render pass, not a live ticker — the
  // Hours screen shows history, not the Today card's live timer. Recomputed
  // whenever the screen remounts (tab focus), which is close enough for a
  // "so far today" figure that isn't the headline feature here.
  const nowMs = useMemo(() => Date.now(), []);
  // 0 = the current week; negative = weeks back. Reset to 0 whenever the
  // screen remounts (tab focus) — same "close enough, not sticky" call as
  // `nowMs` above, and it means returning to the tab always lands on the
  // current week rather than wherever navigation was left.
  const [weekOffset, setWeekOffset] = useState(0);
  const currentWeekStartISO = useMemo(
    () => getWeekStartISO(new Date(), timezone),
    [timezone]
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
  // Clamped at `-MAX_WEEKS_BACK` — see that constant's comment.
  const handlePreviousWeek = useCallback(() => {
    setWeekOffset(offset => Math.max(offset - 1, -MAX_WEEKS_BACK));
  }, []);
  // Clamped at 0 — there are no hours yet for a future week, and an empty
  // future week reads as a bug rather than as "nothing to show".
  const handleNextWeek = useCallback(() => {
    setWeekOffset(offset => Math.min(offset + 1, 0));
  }, []);
  const isNextWeekDisabled = weekOffset >= 0;
  const isPreviousWeekDisabled = weekOffset <= -MAX_WEEKS_BACK;

  if (onboarding.status === 'loading' || activeHousehold.isLoading) {
    return (
      <View testID="hours-screen" className="flex-1 bg-background">
        <LoadingIndicator testID="hours-loading" />
      </View>
    );
  }

  if (!activeHousehold.householdId || !onboarding.role) {
    return (
      <ScrollView
        testID="hours-screen"
        className="flex-1 bg-background"
        contentContainerStyle={SCREEN_CONTENT_STYLE}
      >
        <H1>{t('title')}</H1>
      </ScrollView>
    );
  }

  return (
    <View testID="hours-screen" className="flex-1 bg-background">
      <View className="px-6 pt-2">
        <Body
          testID="hours-monday-week-note"
          className="text-muted-foreground text-sm"
        >
          {tSettings('time.weekStartsHint')}
        </Body>
      </View>
      {canViewParentSchedule(onboarding.role) ? (
        <ParentWeekView
          householdId={activeHousehold.householdId}
          weekStartISO={weekStartISO}
          weekDates={weekDates}
          weekRangeLabel={weekRangeLabel}
          nowMs={nowMs}
          onPreviousWeek={handlePreviousWeek}
          onNextWeek={handleNextWeek}
          isNextWeekDisabled={isNextWeekDisabled}
          isPreviousWeekDisabled={isPreviousWeekDisabled}
          readOnly={!isParentEditorRole(onboarding.role)}
        />
      ) : (
        <NannyWeekView
          householdId={activeHousehold.householdId}
          weekStartISO={weekStartISO}
          weekDates={weekDates}
          weekRangeLabel={weekRangeLabel}
          nowMs={nowMs}
          onPreviousWeek={handlePreviousWeek}
          onNextWeek={handleNextWeek}
          isNextWeekDisabled={isNextWeekDisabled}
          isPreviousWeekDisabled={isPreviousWeekDisabled}
        />
      )}
    </View>
  );
}
