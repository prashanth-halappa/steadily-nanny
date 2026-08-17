/**
 * Parent read-only view of a household carer's stated availability.
 *
 * S9 item 3 fix: with two active carers, resolving "the" nanny with a bare
 * `find()` silently showed whichever came first in the members payload —
 * confidently wrong, never announced. An explicit `?carerId=` (the settings
 * row now routes through `CarerProfileScreen`, which always has one)
 * disambiguates; `find()` over active nanny/helper members survives only as
 * the fallback for the one case it was never wrong for — a single active
 * carer, reached via a bare link with no id.
 */
import { HOUSEHOLD_MEMBER_STATUSES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { BackButton } from '@/src/components/ui/back-button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useAvailabilityForCarer } from '@/src/hooks/queries/useAvailabilityForCarer';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { timeToMinutes } from '@/src/lib/displayTime';

function normalizeParam(
  value: string | string[] | undefined
): string | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export default function CarerAvailabilityScreen() {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { t: tSchedule } = useTranslation('schedule');
  const router = useRouter();
  const { refreshControl } = usePullToRefresh();
  const params = useLocalSearchParams<{ carerId?: string | string[] }>();
  const carerId = normalizeParam(params.carerId);
  const active = useActiveHousehold();
  const members = useHouseholdMembers(active.householdId);
  const nannyMember = useMemo(() => {
    const activeCarers = (members.data ?? []).filter(
      m => m.status === HOUSEHOLD_MEMBER_STATUSES.ACTIVE
    );
    if (carerId) {
      return activeCarers.find(m => m.user_id === carerId) ?? null;
    }
    // Members endpoint includes candidates for the terms-proposal inbox; a
    // candidate has no availability to manage.
    return (
      activeCarers.find(m => m.role === 'nanny' || m.role === 'helper') ?? null
    );
  }, [members.data, carerId]);
  const nannyId = nannyMember?.user_id ?? null;
  const availability = useAvailabilityForCarer(nannyId);

  // One line under the H1 so a parent doesn't have to scan every weekday
  // row to learn the shape of the week. Hidden when there's no window to
  // count — empty, unset, or still loading is all "nothing true to say."
  const availabilitySummary = useMemo(() => {
    const windows: { minutes: number }[] = [];
    for (const row of availability.data ?? []) {
      if (
        !row.is_available ||
        row.earliest_start == null ||
        row.latest_finish == null
      ) {
        continue;
      }
      const minutes =
        timeToMinutes(row.latest_finish) - timeToMinutes(row.earliest_start);
      if (minutes <= 0) continue;
      windows.push({ minutes });
    }
    if (windows.length === 0) return null;
    const hours = windows.reduce((sum, w) => sum + w.minutes, 0) / 60;
    return t('carerAvailabilitySummary', {
      days: windows.length,
      hours,
    });
  }, [availability.data, t]);

  return (
    <ScrollView
      testID="settings-carer-availability-screen"
      className="flex-1 bg-background"
      refreshControl={refreshControl}
      contentContainerStyle={SCREEN_CONTENT_STYLE}
    >
      <BackButton onPress={() => router.back()} label={tCommon('back')} />
      <H1 className="mt-1">{t('carerAvailability')}</H1>
      {availabilitySummary ? (
        <Small
          testID="carer-availability-summary"
          className="mt-1 text-muted-foreground"
        >
          {availabilitySummary}
        </Small>
      ) : null}
      {members.isLoading || availability.isLoading ? (
        <LoadingIndicator />
      ) : !nannyId ? (
        <View testID="carer-availability-empty">
          <EmptyState
            variant="inline"
            title={t('carerAvailabilityEmpty')}
            description=""
          />
        </View>
      ) : (availability.data ?? []).length === 0 ? (
        <View testID="carer-availability-none">
          <EmptyState
            variant="inline"
            title={t('carerAvailabilityNone', {
              name: resolveCarerName(nannyMember, t('carerAvailability')),
            })}
            description=""
          />
        </View>
      ) : (
        <View className="mt-4 gap-2">
          {(availability.data ?? []).map(row => (
            <View
              key={row.id}
              testID={`carer-availability-${row.id}`}
              className="rounded-row bg-card px-4 py-3"
            >
              <Body weight="medium">{tSchedule(`weekday.${row.weekday}`)}</Body>
              <Small className="text-muted-foreground" tabular>
                {(row.earliest_start ?? '—').toString().slice(0, 5)}–
                {(row.latest_finish ?? '—').toString().slice(0, 5)}
              </Small>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
