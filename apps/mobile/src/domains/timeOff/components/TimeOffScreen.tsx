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
import type {
  CarerTimeOff,
  CarerTimeOffStatus,
} from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';
import { BackButton } from '@/src/components/ui/back-button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { H1, MetadataLabel, Small } from '@/src/components/ui/typography';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useCancelTimeOff } from '@/src/hooks/mutations/useCancelTimeOff';
import { useUpdateTimeOff } from '@/src/hooks/mutations/useUpdateTimeOff';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useTimeOff } from '@/src/hooks/queries/useTimeOff';
import { showSuccessToast } from '@/src/lib/toast';
import { usePaidFamilyCounts } from '../hooks/usePaidFamilyCounts';
import { SickTimeOffButton } from './SickTimeOffButton';
import { TimeOffRequestForm } from './TimeOffRequestForm';
import { TimeOffRow } from './TimeOffRow';

type StatusFilter = 'all' | CarerTimeOffStatus;

const FILTERS: readonly StatusFilter[] = [
  'all',
  'confirmed',
  'cancelled',
] as const;

export function TimeOffScreen() {
  const router = useRouter();
  const { t } = useTranslation('timeOff');
  const { t: tCommon } = useTranslation('common');
  const onboarding = useIsOnboarded();
  const timeOff = useTimeOff();
  const cancelTimeOff = useCancelTimeOff();
  const updateTimeOff = useUpdateTimeOff();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [editingTimeOff, setEditingTimeOff] = useState<CarerTimeOff | null>(
    null
  );

  const handleEdit = (id: string) => {
    const row = (timeOff.data ?? []).find(item => item.id === id);
    if (row) setEditingTimeOff(row);
  };

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
    <BackButton
      testID="time-off-back"
      onPress={() => router.back()}
      label={tCommon('back')}
    />
  );

  const allRows = timeOff.data ?? [];
  const rows = useMemo(
    () =>
      statusFilter === 'all'
        ? allRows
        : allRows.filter(row => row.status === statusFilter),
    [allRows, statusFilter]
  );
  // Anonymised cross-family paid-marker counts (TIER0-CX-SPEC.md §5.2) —
  // computed once for the whole visible list; a household id or name never
  // leaves `usePaidFamilyCounts` itself. While loading, every row's marker
  // is omitted (`undefined`) rather than guessing "not marked paid".
  const paidFamilyCounts = usePaidFamilyCounts(allRows);

  if (onboarding.status === 'loading') {
    return (
      <View testID="time-off-screen" className="flex-1 bg-background">
        <View
          style={{
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
          }}
        >
          {backHeader}
        </View>
        <LoadingIndicator testID="time-off-loading" />
      </View>
    );
  }

  // A removed nanny is STILL role `nanny`, so the role check alone lets her
  // through to request/cancel/edit — writes the server now 403s.
  if (onboarding.role !== SETUP_ROLES.NANNY || onboarding.isPastMember) {
    return (
      <View testID="time-off-screen" className="flex-1 bg-background">
        <View
          style={{
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
          }}
        >
          {backHeader}
        </View>
        <View
          testID="time-off-not-available"
          className="mt-8"
          style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
        >
          <EmptyState
            variant="inline"
            title={t('notAvailableTitle')}
            description={t('notAvailableDescription')}
          />
        </View>
      </View>
    );
  }

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
            onEdit={handleEdit}
            isCancelling={cancelTimeOff.isPending}
            isEditing={updateTimeOff.isPending}
            paidFamilyCount={
              paidFamilyCounts.isLoading
                ? undefined
                : (paidFamilyCounts.counts.get(item.id) ?? 0)
            }
          />
        )}
        ListHeaderComponent={
          <View className="mb-2 gap-1">
            {backHeader}
            <H1 testID="time-off-header">{t('screenTitle')}</H1>
            {editingTimeOff ? null : <SickTimeOffButton />}
            {editingTimeOff ? (
              <TimeOffRequestForm
                key={editingTimeOff.id}
                editTimeOff={editingTimeOff}
                onEditDismiss={() => setEditingTimeOff(null)}
                updateTimeOff={updateTimeOff}
              />
            ) : (
              <TimeOffRequestForm />
            )}
            <View testID="time-off-status-filters" className="mt-4 gap-2">
              <MetadataLabel className="text-muted-foreground">
                {t('filterLabel')}
              </MetadataLabel>
              <View className="flex-row flex-wrap gap-2">
                {FILTERS.map(filter => (
                  <Pressable
                    key={filter}
                    testID={`time-off-filter-${filter}`}
                    accessibilityRole="button"
                    onPress={() => setStatusFilter(filter)}
                  >
                    <Small
                      className={cn(
                        'rounded-chip border px-3 py-2',
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
          </View>
        }
        ListEmptyComponent={
          timeOff.isLoading ? (
            <LoadingIndicator testID="time-off-loading" />
          ) : (
            <View testID="time-off-empty">
              <EmptyState
                variant="inline"
                image={illustrations.emptyTimeOff}
                title={t('emptyTitle')}
                description={t('emptyDescription')}
              />
            </View>
          )
        }
        contentContainerStyle={SCREEN_CONTENT_STYLE}
      />
    </View>
  );
}
