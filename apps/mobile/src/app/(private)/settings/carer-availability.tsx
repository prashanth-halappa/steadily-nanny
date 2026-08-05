/**
 * Parent read-only view of the household nanny's stated availability.
 */
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useAvailabilityForCarer } from '@/src/hooks/queries/useAvailabilityForCarer';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';

export default function CarerAvailabilityScreen() {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { t: tSchedule } = useTranslation('schedule');
  const router = useRouter();
  const active = useActiveHousehold();
  const members = useHouseholdMembers(active.householdId);
  const nannyId = useMemo(
    () =>
      (members.data ?? []).find(m => m.role === 'nanny' || m.role === 'helper')
        ?.user_id ?? null,
    [members.data]
  );
  const availability = useAvailabilityForCarer(nannyId);

  return (
    <ScrollView
      testID="settings-carer-availability-screen"
      className="flex-1 bg-background"
      contentContainerStyle={SCREEN_CONTENT_STYLE}
    >
      <Pressable onPress={() => router.back()} className="self-start">
        <Body className="text-primary">{`< ${tCommon('back')}`}</Body>
      </Pressable>
      <H1 className="mt-2">{t('carerAvailability')}</H1>
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
            title={t('carerAvailabilityNone')}
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
