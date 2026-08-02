/**
 * @module domains/timesheet/components/HoursScreen
 *
 * The Hours tab — role-aware. A nanny sees her own week's entries and
 * total; a parent sees the week for their carer plus Approve/Query. Role +
 * household come from `useIsOnboarded()` (server-derived), never a local
 * flag — see that hook's header comment for why that distinction is
 * ship-blocking. "Hours only — no payments here."
 */
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { H1 } from '@/src/components/ui/typography';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import {
  formatWeekRangeLabel,
  getWeekDates,
  getWeekStartISO,
} from '../utils/week';
import { NannyWeekView } from './NannyWeekView';
import { ParentWeekView } from './ParentWeekView';

export function HoursScreen() {
  const onboarding = useIsOnboarded();
  // `useIsOnboarded` already fetches households internally, so this is a
  // cache hit, not a second request — needed here for `timezone`, which
  // that hook doesn't expose.
  const households = useHouseholds();
  const household =
    households.data?.find(h => h.id === onboarding.householdId) ?? null;
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
  const weekStartISO = useMemo(
    () => getWeekStartISO(new Date(), timezone),
    [timezone]
  );
  const weekDates = useMemo(() => getWeekDates(weekStartISO), [weekStartISO]);
  const weekRangeLabel = useMemo(
    () => formatWeekRangeLabel(weekDates),
    [weekDates]
  );

  if (onboarding.status === 'loading') {
    return (
      <View testID="hours-screen" className="flex-1 bg-background">
        <LoadingIndicator testID="hours-loading" />
      </View>
    );
  }

  if (!onboarding.householdId || !onboarding.role) {
    return (
      <ScrollView
        testID="hours-screen"
        className="flex-1 bg-background"
        contentContainerStyle={{ padding: 24, paddingBottom: 100 }}
      >
        <H1>Hours</H1>
      </ScrollView>
    );
  }

  return (
    <View testID="hours-screen" className="flex-1 bg-background">
      {onboarding.role === SETUP_ROLES.PARENT ? (
        <ParentWeekView
          householdId={onboarding.householdId}
          weekStartISO={weekStartISO}
          weekDates={weekDates}
          weekRangeLabel={weekRangeLabel}
          nowMs={nowMs}
        />
      ) : (
        <NannyWeekView
          householdId={onboarding.householdId}
          weekStartISO={weekStartISO}
          weekDates={weekDates}
          weekRangeLabel={weekRangeLabel}
          nowMs={nowMs}
        />
      )}
    </View>
  );
}
