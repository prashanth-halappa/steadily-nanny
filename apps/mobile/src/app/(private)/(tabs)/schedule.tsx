/**
 * @module app/(private)/(tabs)/schedule
 *
 * Role-aware Schedule tab. Nannies always land on the week calendar.
 * Parents/helpers ALSO always land on the calendar now — pattern status
 * (none / draft / pending / declined / withdrawn / accepted) is a banner
 * above it, never a full-screen takeover. A full-screen
 * `SchedulePendingScreen` used to hide the calendar (and any still-live
 * shifts, one-off shifts, and the "Add a one-off shift" button) for every
 * state except `accepted` — see `SchedulePatternBanner` for the per-state
 * banner and `/(private)/schedule/usual-week` for the pushed detail screen.
 */

import { HOUSEHOLD_STATES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import {
  SchedulePatternBanner,
  ScheduleShiftsScreen,
} from '@/src/domains/schedule';
import { resolveActivePattern } from '@/src/domains/schedule/utils/patternPrecedence';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useSchedulePatterns } from '@/src/hooks/queries/useSchedulePatterns';

export default function ScheduleRoute() {
  const { t } = useTranslation('schedule');
  const onboarding = useIsOnboarded();
  const activeHousehold = useActiveHousehold();
  // Fetched for every role now, not just parent/helper (for the banner) —
  // a nanny's empty-state copy (P0 0.2) needs to know whether an accepted
  // pattern exists too: "the family hasn't set your schedule yet" reads
  // very differently from "no shifts this week".
  const patterns = useSchedulePatterns(onboarding.householdId);
  // Not `.find(p => p.status !== 'ended')` — that let whichever non-ended
  // row the API listed first win, so a stale `withdrawn` could outrank a
  // week genuinely sitting with the nanny. See `patternPrecedence.ts`.
  const pattern = resolveActivePattern(patterns.data ?? []);

  if (onboarding.membershipsError) {
    return (
      <View testID="schedule-tab-error" style={{ flex: 1 }}>
        <ErrorState onRetry={onboarding.retryMemberships} />
      </View>
    );
  }

  if (onboarding.status === 'loading') {
    return <LoadingIndicator testID="schedule-tab-loading" />;
  }

  // D-36 §S6 item 4: the draft is HERS — she authored it, set her own rate
  // and invited a family. No shifts exist because nothing can insert one
  // into a draft household (093), so this is a true empty state, not a
  // loading gap — never "the family is still setting up", there is no
  // family yet.
  if (activeHousehold.household?.state === HOUSEHOLD_STATES.DRAFT) {
    return (
      <View testID="schedule-tab-draft-empty" style={{ flex: 1 }}>
        <EmptyState
          variant="inline"
          image={illustrations.emptySchedule}
          title={t('tab.draftEmptyTitle')}
          description={t('tab.draftEmptyDescription')}
        />
      </View>
    );
  }

  if (onboarding.role === null) {
    return (
      <View testID="schedule-tab-empty" style={{ flex: 1 }}>
        <EmptyState
          variant="inline"
          image={illustrations.emptySchedule}
          title={t('tab.emptyTitle')}
          description={t('tab.emptyDescription')}
        />
      </View>
    );
  }

  if (onboarding.role === SETUP_ROLES.NANNY) {
    return (
      <ScheduleShiftsScreen
        showBack={false}
        pattern={pattern}
        patternLoading={patterns.isLoading}
      />
    );
  }

  return (
    <ScheduleShiftsScreen
      showBack={false}
      pattern={pattern}
      patternLoading={patterns.isLoading}
      patternBanner={
        <SchedulePatternBanner
          pattern={pattern}
          householdId={onboarding.householdId}
          isLoading={patterns.isLoading}
        />
      }
    />
  );
}
