/**
 * @module domains/householdClosures/components/HouseholdClosuresScreen
 *
 * Settings -> "We're away" (parent only). A parent declares a date range
 * the household needs no cover for — members (carers) can read these so
 * they know not to expect shifts, but only owner/parent may write
 * (`035_household_closures.sql`). There is no entry point for a nanny/helper
 * to reach this route, but a direct deep link still gets an honest
 * "not available" message rather than a broken or misleading form — same
 * pattern as `TimeOffScreen` (nanny-only) mirrored the other way.
 *
 * Reuses `TimeOffDateRangePicker` and the all-day date <-> wire-instant
 * helpers from the `timeOff` domain rather than re-implementing a date-range
 * picker: `household_closures` has no `all_day` column, but the same
 * "local-midnight start, exclusive local-midnight-next-day end" convention
 * applies by construction (`CreateHouseholdClosureSchema` only requires
 * `ends_at > starts_at`).
 *
 * ONE FlashList, not a form plus a separate list — same reason
 * `TimeOffScreen` puts the form in `ListHeaderComponent`: a virtualised list
 * nested inside a `ScrollView` produces RN's "VirtualizedLists should never
 * be nested" warning and broken scroll behaviour.
 *
 * Delete is confirmed via `AlertDialog` — removing a closure makes those
 * days count as needing cover again.
 */
import { FlashList } from '@shopify/flash-list';
import type { HouseholdClosure } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { InlineRetry } from '@/src/components/custom/InlineRetry';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/src/components/ui/alert-dialog';
import { BackButton } from '@/src/components/ui/back-button';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { TimeOffDateRangePicker } from '@/src/domains/timeOff/components/TimeOffDateRangePicker';
import { isEndOnOrAfterStart } from '@/src/domains/timeOff/components/TimeOffDateRangePicker.utils';
import {
  formatTimeOffRangeLabel,
  isPastTimeOff,
  toAllDayRange,
  todayISO,
} from '@/src/domains/timeOff/utils/timeOffDate';
import { useCreateHouseholdClosure } from '@/src/hooks/mutations/useCreateHouseholdClosure';
import { useDeleteHouseholdClosure } from '@/src/hooks/mutations/useDeleteHouseholdClosure';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdClosures } from '@/src/hooks/queries/useHouseholdClosures';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { showSuccessToast } from '@/src/lib/toast';

export function HouseholdClosuresScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const { t: tCommon } = useTranslation('common');
  const { t: tErrors } = useTranslation('errors');
  const onboarding = useIsOnboarded();
  const householdId = onboarding.householdId;
  const closures = useHouseholdClosures(householdId);
  const createClosure = useCreateHouseholdClosure(householdId ?? '');
  const deleteClosure = useDeleteHouseholdClosure(householdId ?? '');
  const { refreshing, onRefresh } = usePullToRefresh();
  // A closure names the HOUSEHOLD's calendar days — all-day boundaries and
  // row labels must use the household clock, not the device's (same rule as
  // time off; a Pacific device once stored a London "24–25 Aug" closure as
  // PDT midnights, spilling 8h into Aug 26).
  const { household } = useActiveHousehold();
  const timeZone = household?.timezone;

  const [startDate, setStartDate] = useState(todayISO(new Date(), timeZone));
  const [endDate, setEndDate] = useState(todayISO(new Date(), timeZone));
  const [message, setMessage] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const invalid = !isEndOnOrAfterStart(startDate, endDate);

  const backHeader = (
    <BackButton
      testID="household-closures-back"
      onPress={() => router.back()}
      label={tCommon('back')}
    />
  );

  if (onboarding.status === 'loading') {
    return (
      <View testID="household-closures-screen" className="flex-1 bg-background">
        <View
          style={{
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
          }}
        >
          {backHeader}
        </View>
        <LoadingIndicator testID="household-closures-loading" />
      </View>
    );
  }

  if (onboarding.role !== SETUP_ROLES.PARENT) {
    return (
      <View testID="household-closures-screen" className="flex-1 bg-background">
        <View
          style={{
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
          }}
        >
          {backHeader}
        </View>
        <View
          testID="household-closures-not-available"
          className="mt-8"
          style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
        >
          <EmptyState
            variant="inline"
            title={t('closures.notAvailableTitle')}
            description={t('closures.notAvailableDescription')}
          />
        </View>
      </View>
    );
  }

  const handleSubmit = async () => {
    if (createClosure.isPending || invalid) return;
    const { starts_at, ends_at } = toAllDayRange(startDate, endDate, timeZone);
    const trimmedMessage = message.trim();
    try {
      await createClosure.mutateAsync({
        starts_at,
        ends_at,
        ...(trimmedMessage ? { message: trimmedMessage } : {}),
      });
    } catch {
      return;
    }
    setMessage('');
    showSuccessToast(t('closures.createdToast'));
  };

  const handleDelete = async (id: string) => {
    if (deleteClosure.isPending) return;
    try {
      await deleteClosure.mutateAsync(id);
    } catch {
      return;
    }
    showSuccessToast(t('closures.deletedToast'));
  };

  const confirmDelete = () => {
    const id = pendingDeleteId;
    if (!id) return;
    setPendingDeleteId(null);
    void handleDelete(id);
  };

  return (
    <View testID="household-closures-screen" className="flex-1 bg-background">
      {/* The message Textarea lives in the list header; without this the
          keyboard covers it and the submit button together. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlashList
          testID="household-closures-list"
          data={closures.data ?? []}
          keyExtractor={(row: HouseholdClosure) => row.id}
          refreshing={refreshing}
          onRefresh={onRefresh}
          renderItem={({ item }: { item: HouseholdClosure }) => {
            const isPast = isPastTimeOff(item.ends_at);
            return (
              <Card
                testID={`household-closures-row-${item.id}`}
                className="mb-3 gap-1 p-4"
              >
                <Body>
                  {formatTimeOffRangeLabel(
                    item.starts_at,
                    item.ends_at,
                    timeZone
                  )}
                </Body>
                {item.message ? (
                  <Small className="text-muted-foreground">
                    {item.message}
                  </Small>
                ) : null}
                {isPast ? null : (
                  <View className="mt-2 flex-row">
                    <Button
                      testID={`household-closures-delete-${item.id}`}
                      variant="ghost"
                      disabled={deleteClosure.isPending}
                      onPress={() => setPendingDeleteId(item.id)}
                    >
                      <Text className="text-destructive">
                        {t('closures.deleteButton')}
                      </Text>
                    </Button>
                  </View>
                )}
              </Card>
            );
          }}
          ListHeaderComponent={
            <View className="mb-2 gap-1">
              {backHeader}
              <H1 testID="household-closures-header">
                {t('closures.screenTitle')}
              </H1>
              <Small className="mb-2 text-muted-foreground">
                {t('closures.screenSubtitle')}
              </Small>
              <View testID="household-closures-form" className="mb-6 gap-4">
                <Body weight="medium">{t('closures.formTitle')}</Body>
                <TimeOffDateRangePicker
                  testID="household-closures-dates"
                  start={startDate}
                  end={endDate}
                  onChange={(start, end) => {
                    setStartDate(start);
                    setEndDate(end);
                  }}
                />
                <Textarea
                  testID="household-closures-message"
                  accessibilityLabel={t('closures.messageLabel')}
                  placeholder={t('closures.messagePlaceholder')}
                  value={message}
                  onChangeText={setMessage}
                />
                <Button
                  testID="household-closures-submit"
                  disabled={invalid || createClosure.isPending}
                  onPress={() => void handleSubmit()}
                >
                  <Text>{t('closures.submitButton')}</Text>
                </Button>
              </View>
            </View>
          }
          ListEmptyComponent={
            closures.isLoading ? (
              <LoadingIndicator testID="household-closures-loading" />
            ) : closures.isError ? (
              // False alarm (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B): only
              // `isLoading` was checked — a settled-with-error read has
              // `isLoading: false` too, and used to print the "no closures"
              // empty state over rows that genuinely exist.
              <View className="mt-4">
                <InlineRetry
                  testID="household-closures-retry"
                  message={tErrors('network')}
                  onRetry={() => void closures.refetch()}
                />
              </View>
            ) : (
              <View testID="household-closures-empty">
                <EmptyState
                  variant="inline"
                  image={illustrations.emptyHousehold}
                  title={t('closures.emptyTitle')}
                  description={t('closures.emptyDescription')}
                />
              </View>
            )
          }
          contentContainerStyle={SCREEN_CONTENT_STYLE}
          keyboardShouldPersistTaps="handled"
        />
      </KeyboardAvoidingView>

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={open => {
          if (!open) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('closures.deleteConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('closures.deleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel testID="household-closures-delete-cancel">
              <Text>{t('closures.deleteConfirmCancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              testID="household-closures-delete-confirm"
              onPress={confirmDelete}
            >
              <Text>{t('closures.deleteConfirmConfirm')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}
