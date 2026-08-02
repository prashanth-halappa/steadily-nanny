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
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { H1 } from '@/src/components/ui/typography';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useCancelTimeOff } from '@/src/hooks/mutations/useCancelTimeOff';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useTimeOff } from '@/src/hooks/queries/useTimeOff';
import { showSuccessToast } from '@/src/lib/toast';
import { TimeOffRequestForm } from './TimeOffRequestForm';
import { TimeOffRow } from './TimeOffRow';

export function TimeOffScreen() {
  const { t } = useTranslation('timeOff');
  const onboarding = useIsOnboarded();
  const timeOff = useTimeOff();
  const cancelTimeOff = useCancelTimeOff();

  const handleCancel = async (id: string) => {
    if (cancelTimeOff.isPending) return;
    try {
      await cancelTimeOff.mutateAsync(id);
    } catch {
      return;
    }
    showSuccessToast(t('cancelledToast'));
  };

  if (onboarding.status === 'loading') {
    return (
      <View testID="time-off-screen" className="flex-1 bg-background">
        <LoadingIndicator testID="time-off-loading" />
      </View>
    );
  }

  if (onboarding.role !== SETUP_ROLES.NANNY) {
    return (
      <View testID="time-off-screen" className="flex-1 bg-background">
        <View testID="time-off-not-available" className="mt-8">
          <EmptyState
            variant="inline"
            title={t('notAvailableTitle')}
            description={t('notAvailableDescription')}
          />
        </View>
      </View>
    );
  }

  const rows = timeOff.data ?? [];

  return (
    <View testID="time-off-screen" className="flex-1 bg-background">
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
            <H1 testID="time-off-header">{t('screenTitle')}</H1>
            <TimeOffRequestForm />
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
    </View>
  );
}
