/**
 * @module domains/timeOff/components/TimeOffScreen
 *
 * Settings -> Time off (nanny only, reached from `settings-request-time-off`
 * in `app/(private)/(tabs)/settings.tsx`). Role gate mirrors `TodayScreen`'s
 * pattern: server-derived `useIsOnboarded().role`, never local
 * setup-wizard state — see that hook's header comment for why the
 * distinction is ship-blocking. There is no entry point for a parent to
 * reach this route, but a direct deep link should still get an honest
 * "not available" message rather than a broken or misleading form.
 *
 * ONE FlashList, not a form plus a separate list — same reason
 * `ParentWeekView` puts `WeekTotal` in `ListHeaderComponent` rather than a
 * sibling `ScrollView`: nesting a virtualised list inside a `ScrollView`
 * produces RN's "VirtualizedLists should never be nested" warning and
 * broken scroll behaviour.
 *
 * `.mutateAsync(...)` is wrapped in try/catch for the same reason as
 * `TimeOffRequestForm`'s submit handler — see that file's header comment.
 */
import { FlashList } from '@shopify/flash-list';
import type { CarerTimeOffStatus } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useCancelTimeOff } from '@/src/hooks/mutations/useCancelTimeOff';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useTimeOff } from '@/src/hooks/queries/useTimeOff';
import { showSuccessToast } from '@/src/lib/toast';
import { TimeOffRequestForm } from './TimeOffRequestForm';
import { TimeOffRow } from './TimeOffRow';

type StatusFilter = 'all' | CarerTimeOffStatus;

const FILTERS: readonly StatusFilter[] = [
  'all',
  'confirmed',
  'requested',
  'cancelled',
] as const;

export function TimeOffScreen() {
  const router = useRouter();
  const { t } = useTranslation('timeOff');
  const { t: tCommon } = useTranslation('common');
  const onboarding = useIsOnboarded();
  const timeOff = useTimeOff();
  const cancelTimeOff = useCancelTimeOff();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const handleCancel = async (id: string) => {
    if (cancelTimeOff.isPending) return;
    try {
      await cancelTimeOff.mutateAsync(id);
    } catch {
      return;
    }
    showSuccessToast(t('cancelledToast'));
  };

  const backHeader = (
    <Pressable
      testID="time-off-back"
      accessibilityRole="button"
      accessibilityLabel={tCommon('back')}
      onPress={() => router.back()}
      hitSlop={8}
      className="mb-2 self-start"
    >
      <Body className="text-primary">{`< ${tCommon('back')}`}</Body>
    </Pressable>
  );

  const allRows = timeOff.data ?? [];
  const rows = useMemo(
    () =>
      statusFilter === 'all'
        ? allRows
        : allRows.filter(row => row.status === statusFilter),
    [allRows, statusFilter]
  );

  if (onboarding.status === 'loading') {
    return (
      <View testID="time-off-screen" className="flex-1 bg-background">
        <SafeAreaView style={{ flex: 1 }} className="bg-background">
          <View className="px-6 pt-4">{backHeader}</View>
          <LoadingIndicator testID="time-off-loading" />
        </SafeAreaView>
      </View>
    );
  }

  if (onboarding.role !== SETUP_ROLES.NANNY) {
    return (
      <View testID="time-off-screen" className="flex-1 bg-background">
        <SafeAreaView style={{ flex: 1 }} className="bg-background">
          <View className="px-6 pt-4">{backHeader}</View>
          <View testID="time-off-not-available" className="mt-8">
            <EmptyState
              variant="inline"
              title={t('notAvailableTitle')}
              description={t('notAvailableDescription')}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View testID="time-off-screen" className="flex-1 bg-background">
      <SafeAreaView style={{ flex: 1 }} className="bg-background">
        <FlashList
          testID="time-off-list"
          data={rows}
          keyExtractor={row => row.id}
          renderItem={({ item }) => (
            <TimeOffRow
              timeOff={item}
              onCancel={id => void handleCancel(id)}
              isCancelling={cancelTimeOff.isPending}
            />
          )}
          ListHeaderComponent={
            <View className="mb-2 gap-1">
              {backHeader}
              <H1 testID="time-off-header">{t('screenTitle')}</H1>
              <TimeOffRequestForm />
              <View
                testID="time-off-status-filters"
                className="mt-4 flex-row flex-wrap gap-2"
              >
                {FILTERS.map(filter => (
                  <Pressable
                    key={filter}
                    testID={`time-off-filter-${filter}`}
                    accessibilityRole="button"
                    onPress={() => setStatusFilter(filter)}
                  >
                    <Small
                      className={cn(
                        'rounded-chip border px-3 py-1.5',
                        statusFilter === filter
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-foreground'
                      )}
                    >
                      {filter === 'all'
                        ? t('filterAll')
                        : t(`status.${filter}`)}
                    </Small>
                  </Pressable>
                ))}
              </View>
            </View>
          }
          ListEmptyComponent={
            timeOff.isLoading ? (
              <LoadingIndicator testID="time-off-loading" />
            ) : (
              <View testID="time-off-empty">
                <EmptyState
                  variant="inline"
                  title={t('emptyTitle')}
                  description={t('emptyDescription')}
                />
              </View>
            )
          }
          contentContainerStyle={{ padding: 24, paddingBottom: 100 }}
        />
      </SafeAreaView>
    </View>
  );
}
