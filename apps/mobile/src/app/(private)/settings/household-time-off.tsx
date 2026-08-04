/**
 * Parent read-only list of household carers' time off.
 */
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdTimeOff } from '@/src/hooks/queries/useHouseholdTimeOff';

export default function HouseholdTimeOffScreen() {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const active = useActiveHousehold();
  const timeOff = useHouseholdTimeOff(active.householdId);

  const rows = (timeOff.data ?? []).filter(r => r.status !== 'cancelled');

  return (
    <ScrollView
      testID="settings-household-time-off-screen"
      className="flex-1 bg-background"
      contentContainerStyle={SCREEN_CONTENT_STYLE}
    >
      <Pressable onPress={() => router.back()} className="self-start">
        <Body className="text-primary">{`< ${tCommon('back')}`}</Body>
      </Pressable>
      <H1 className="mt-2">{t('carerTimeOff')}</H1>
      <Small className="mt-1 text-muted-foreground">
        {t('carerTimeOffHint')}
      </Small>
      {timeOff.isLoading ? (
        <LoadingIndicator />
      ) : rows.length === 0 ? (
        <EmptyState
          variant="inline"
          title={t('carerTimeOffEmpty')}
          description=""
        />
      ) : (
        <View className="mt-4 gap-2">
          {rows.map(row => (
            <View
              key={row.id}
              testID={`household-time-off-${row.id}`}
              className="rounded-row bg-card px-4 py-3"
            >
              <Body className="font-medium">
                {formatDisplayDate(row.starts_at.slice(0, 10))}
                {' – '}
                {formatDisplayDate(row.ends_at.slice(0, 10))}
              </Body>
              <Small className="text-muted-foreground">{row.status}</Small>
              {row.message ? (
                <Small className="text-muted-foreground">{row.message}</Small>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
