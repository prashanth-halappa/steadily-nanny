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
 * HARD DELETE, no confirmation dialog — mirrors `TimeOffRow`'s Cancel
 * control, which also has no confirm step.
 */
import { FlashList } from '@shopify/flash-list';
import type { HouseholdClosure } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { TimeOffDateRangePicker } from '@/src/domains/timeOff/components/TimeOffDateRangePicker';
import {
  formatTimeOffRangeLabel,
  isPastTimeOff,
  toAllDayRange,
} from '@/src/domains/timeOff/utils/timeOffDate';
import { useCreateHouseholdClosure } from '@/src/hooks/mutations/useCreateHouseholdClosure';
import { useDeleteHouseholdClosure } from '@/src/hooks/mutations/useDeleteHouseholdClosure';
import { useHouseholdClosures } from '@/src/hooks/queries/useHouseholdClosures';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { showSuccessToast } from '@/src/lib/toast';

/** Today's calendar date, "yyyy-mm-dd", in the DEVICE's local zone. */
function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function HouseholdClosuresScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const { t: tCommon } = useTranslation('common');
  const onboarding = useIsOnboarded();
  const householdId = onboarding.householdId;
  const closures = useHouseholdClosures(householdId);
  const createClosure = useCreateHouseholdClosure(householdId ?? '');
  const deleteClosure = useDeleteHouseholdClosure(householdId ?? '');

  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [message, setMessage] = useState('');

  const backHeader = (
    <Pressable
      testID="household-closures-back"
      accessibilityRole="button"
      accessibilityLabel={tCommon('back')}
      onPress={() => router.back()}
      hitSlop={8}
      className="mb-2 self-start"
    >
      <Body className="text-primary">{`< ${tCommon('back')}`}</Body>
    </Pressable>
  );

  if (onboarding.status === 'loading') {
    return (
      <View testID="household-closures-screen" className="flex-1 bg-background">
        <SafeAreaView style={{ flex: 1 }} className="bg-background">
          <View
            style={{
              paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
              paddingTop: 16,
            }}
          >
            {backHeader}
          </View>
          <LoadingIndicator testID="household-closures-loading" />
        </SafeAreaView>
      </View>
    );
  }

  if (onboarding.role !== SETUP_ROLES.PARENT) {
    return (
      <View testID="household-closures-screen" className="flex-1 bg-background">
        <SafeAreaView style={{ flex: 1 }} className="bg-background">
          <View
            style={{
              paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
              paddingTop: 16,
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
        </SafeAreaView>
      </View>
    );
  }

  const handleSubmit = async () => {
    if (createClosure.isPending) return;
    const { starts_at, ends_at } = toAllDayRange(startDate, endDate);
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

  return (
    <View testID="household-closures-screen" className="flex-1 bg-background">
      <SafeAreaView style={{ flex: 1 }} className="bg-background">
        <FlashList
          testID="household-closures-list"
          data={closures.data ?? []}
          keyExtractor={(row: HouseholdClosure) => row.id}
          renderItem={({ item }: { item: HouseholdClosure }) => {
            const isPast = isPastTimeOff(item.ends_at);
            return (
              <Card
                testID={`household-closures-row-${item.id}`}
                className="mb-3 gap-1 p-4"
              >
                <Body>
                  {formatTimeOffRangeLabel(item.starts_at, item.ends_at)}
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
                      onPress={() => void handleDelete(item.id)}
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
                  disabled={createClosure.isPending}
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
            ) : (
              <View testID="household-closures-empty">
                <EmptyState
                  variant="inline"
                  title={t('closures.emptyTitle')}
                  description={t('closures.emptyDescription')}
                />
              </View>
            )
          }
          contentContainerStyle={SCREEN_CONTENT_STYLE}
        />
      </SafeAreaView>
    </View>
  );
}
