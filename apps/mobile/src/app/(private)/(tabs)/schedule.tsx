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
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { type Href, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
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
import { useHouseholdCarers } from '@/src/domains/schedule/hooks/useHouseholdCarers';
import {
  resolveActivePattern,
  resolvePerCarerPatterns,
} from '@/src/domains/schedule/utils/patternPrecedence';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useSchedulePatterns } from '@/src/hooks/queries/useSchedulePatterns';

export default function ScheduleRoute() {
  const { t } = useTranslation('schedule');
  const router = useRouter();
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
          actionLabel={t('tab.draftEmptyActionLabel')}
          action={() => router.push('/(private)/(tabs)/home' as Href)}
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
          actionLabel={t('tab.emptyActionLabel')}
          action={() =>
            router.push('/(private)/settings/join-household' as Href)
          }
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
      patternBanner={coverSummary => (
        <ParentPatternBanners
          householdId={onboarding.householdId}
          patterns={patterns.data ?? []}
          patternsLoading={patterns.isLoading}
          coverSummary={coverSummary}
        />
      )}
    />
  );
}

/**
 * S7/S8 for the tab's own banner: one `SchedulePatternBanner` PER CARER,
 * never the household-wide `resolveActivePattern` winner this tab used to
 * collapse to — that hid every carer but the first, with no entry point to
 * build a second nanny's own usual week at all. Carer order comes from
 * `useHouseholdCarers` (the same list the build wizard's picker uses); a
 * carer_id that only shows up in `patterns` (list not loaded yet, or a
 * departed carer whose row survives) still gets a banner rather than being
 * silently dropped. Zero carers at all falls back to the one "no nanny yet"
 * banner today's single-row render always showed.
 */
function ParentPatternBanners({
  householdId,
  patterns,
  patternsLoading,
  coverSummary,
}: {
  householdId: string | null;
  patterns: readonly SchedulePattern[];
  patternsLoading: boolean;
  /**
   * This week's uncovered count. Folded into the FIRST banner that is in its
   * attention arm — one card carrying the cause, its consequence and one
   * action. The count is household-wide while banners are per-carer, so
   * "first" is the only honest placement: attaching it to every carer's card
   * would multiply one fact, and picking a carer would attribute a gap to
   * someone who may not own it. With no attention banner at all there is no
   * card to fold into, so it renders on its own below.
   */
  coverSummary?: ReactNode;
}) {
  const carers = useHouseholdCarers(householdId);
  const perCarerPatterns = resolvePerCarerPatterns(patterns);
  const rowIds = (carers.data ?? []).map(member => member.user_id);
  const extraIds = perCarerPatterns
    .map(carerPattern => carerPattern.carerId)
    .filter(carerId => carerId === null || !rowIds.includes(carerId));
  const bannerCarerIds: Array<string | null> =
    rowIds.length > 0 || extraIds.length > 0
      ? [...rowIds, ...extraIds]
      : [null];

  // Only a non-accepted pattern renders the attention CARD; `accepted` is a
  // bare settled line with nothing to fold into.
  const patternFor = (carerId: string | null) =>
    perCarerPatterns.find(cp => cp.carerId === carerId)?.pattern ?? null;
  const foldIntoCarerId = bannerCarerIds.find(
    carerId => patternFor(carerId)?.status !== 'accepted'
  );
  const folded = foldIntoCarerId !== undefined;

  return (
    <View className="gap-4">
      {bannerCarerIds.map(carerId => (
        <SchedulePatternBanner
          key={carerId ?? 'no-carer'}
          pattern={patternFor(carerId)}
          carerId={carerId}
          householdId={householdId}
          isLoading={patternsLoading || carers.isLoading}
          consequence={carerId === foldIntoCarerId ? coverSummary : undefined}
        />
      ))}
      {folded ? null : coverSummary}
    </View>
  );
}
