/**
 * @module domains/household/components/HouseholdHolidaysScreen
 *
 * Settings -> "Holidays". A parent picks which pack holidays this family
 * observes, plus any household-authored custom days; a nanny (or past
 * member) can read the list but not change it — the API is parents-write.
 * ABSENT from the fetched rows means NOT observed (playbook §2.9): never
 * treat a missing key as on.
 *
 * Country comes from the household named by `onboarding.householdId`
 * (`useHouseholdById`) — never a blind `useActiveHousehold()`, which
 * answers a different question. Unknown country falls back to US.
 *
 * Pack dates are optional: Canada only lists Good Friday / Victoria Day
 * for 2026–2027, so a later year still renders the toggle with no date
 * line rather than vanishing the row.
 *
 * HYDRATE-ONCE local state, ONE Save of both PUTs (toggles + custom set)
 * — not a PUT per flip. Same hydrated-flag effect as `NotificationPrefsScreen`.
 */
import {
  HOLIDAY_COUNTRIES,
  holidayDatesInYear,
} from '@steadily-nanny/shared-types/holidayPacks';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { InlineRetry } from '@/src/components/custom/InlineRetry';
import { BackButton } from '@/src/components/ui/back-button';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Switch } from '@/src/components/ui/switch';
import { Text } from '@/src/components/ui/text';
import { Body, Small } from '@/src/components/ui/typography';
import { formatDisplayDateWithYear } from '@/src/domains/pay/utils/payArrangementForm';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useSetHouseholdCustomHolidays } from '@/src/hooks/mutations/useSetHouseholdCustomHolidays';
import { useSetHouseholdHolidays } from '@/src/hooks/mutations/useSetHouseholdHolidays';
import { useHouseholdById } from '@/src/hooks/queries/useHouseholdById';
import { useHouseholdCustomHolidays } from '@/src/hooks/queries/useHouseholdCustomHolidays';
import { useHouseholdHolidays } from '@/src/hooks/queries/useHouseholdHolidays';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { showSuccessToast } from '@/src/lib/toast';
import type { CustomHolidayDraft } from '../utils/customHolidayForm';
import { sortAndDedupeDates } from '../utils/customHolidayForm';
import { CustomHolidayEditSheet } from './CustomHolidayEditSheet';

export function HouseholdHolidaysScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const { t: tCommon } = useTranslation('common');
  const { t: tErrors } = useTranslation('errors');
  const onboarding = useIsOnboarded();
  const householdId = onboarding.householdId;
  const householdLookup = useHouseholdById(householdId);
  const holidaysQuery = useHouseholdHolidays(householdId);
  const customHolidaysQuery = useHouseholdCustomHolidays(householdId);
  const setHolidays = useSetHouseholdHolidays(householdId ?? '');
  const setCustomHolidays = useSetHouseholdCustomHolidays(householdId ?? '');

  const year = new Date().getFullYear();
  const country = householdLookup.household?.country ?? HOLIDAY_COUNTRIES.US;
  const catalog = useMemo(
    () => holidayDatesInYear(country, year),
    [country, year]
  );
  const canEdit =
    onboarding.role === SETUP_ROLES.PARENT && !onboarding.isPastMember;

  const [observedByKey, setObservedByKey] = useState<Record<string, boolean>>(
    {}
  );
  const [customDays, setCustomDays] = useState<CustomHolidayDraft[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  useEffect(() => {
    if (householdLookup.isLoading) return;
    if (!holidaysQuery.data || !customHolidaysQuery.data || hydrated) return;
    const next: Record<string, boolean> = {};
    for (const entry of catalog) {
      const row = holidaysQuery.data.find(
        item => item.holiday_key === entry.key
      );
      next[entry.key] = row?.observed === true;
    }
    setObservedByKey(next);
    setCustomDays(
      customHolidaysQuery.data.map(row => ({
        name: row.name,
        dates: sortAndDedupeDates(row.dates),
      }))
    );
    setHydrated(true);
  }, [
    holidaysQuery.data,
    customHolidaysQuery.data,
    hydrated,
    householdLookup.isLoading,
    catalog,
  ]);

  const handleToggle = (key: string, next: boolean) => {
    if (!canEdit) return;
    setObservedByKey(prev => ({ ...prev, [key]: next }));
  };

  const handleSave = async () => {
    if (setHolidays.isPending || setCustomHolidays.isPending || !canEdit) {
      return;
    }
    try {
      await setHolidays.mutateAsync({
        holidays: catalog.map(entry => ({
          holiday_key: entry.key,
          observed: observedByKey[entry.key] === true,
        })),
      });
      await setCustomHolidays.mutateAsync({
        custom_holidays: customDays.map(day => ({
          name: day.name,
          dates: [...day.dates],
        })),
      });
    } catch {
      return;
    }
    showSuccessToast(t('holidays.savedToast'));
    router.back();
  };

  const editing =
    editingIndex === null ? null : (customDays[editingIndex] ?? null);
  const siblings =
    editingIndex === null
      ? customDays
      : customDays.filter((_, index) => index !== editingIndex);

  const handleCustomSave = (draft: CustomHolidayDraft) => {
    setCustomDays(prev => {
      if (editingIndex === null) return [...prev, draft];
      return prev.map((row, index) => (index === editingIndex ? draft : row));
    });
    setSheetVisible(false);
    setEditingIndex(null);
  };

  const handleCustomDelete = (index: number) => {
    if (!canEdit) return;
    setCustomDays(prev => prev.filter((_, i) => i !== index));
  };

  const backHeader = (
    <BackButton
      testID="household-holidays-back"
      onPress={() => router.back()}
      label={tCommon('back')}
    />
  );

  const isLoading =
    onboarding.status === 'loading' ||
    holidaysQuery.isLoading ||
    customHolidaysQuery.isLoading ||
    householdLookup.isLoading;

  if (isLoading) {
    return (
      <View
        testID="household-holidays-screen"
        className="flex-1 items-center justify-center bg-background"
      >
        <LoadingIndicator testID="household-holidays-loading" />
      </View>
    );
  }

  if (holidaysQuery.isError || customHolidaysQuery.isError) {
    return (
      <View testID="household-holidays-screen" className="flex-1 bg-background">
        <View
          style={{
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
          }}
        >
          {backHeader}
        </View>
        <View
          className="mt-4"
          style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
        >
          <InlineRetry
            testID="household-holidays-retry"
            message={tErrors('network')}
            onRetry={() => {
              void holidaysQuery.refetch();
              void customHolidaysQuery.refetch();
            }}
          />
        </View>
      </View>
    );
  }

  if (!hydrated) {
    return (
      <View
        testID="household-holidays-screen"
        className="flex-1 items-center justify-center bg-background"
      >
        <LoadingIndicator testID="household-holidays-loading" />
      </View>
    );
  }

  const rows = (
    <>
      {canEdit ? null : (
        <Small className="text-muted-foreground">
          {t('holidays.readOnlyNote')}
        </Small>
      )}
      <Card className="overflow-hidden p-0">
        {catalog.map(entry => (
          <View
            key={entry.key}
            className="flex-row items-center justify-between gap-3 px-4 py-3"
          >
            <View className="flex-1 gap-1">
              <Body weight="medium">{t(`holidays.names.${entry.key}`)}</Body>
              {entry.date ? (
                <Small className="text-muted-foreground">
                  {formatDisplayDateWithYear(entry.date)}
                </Small>
              ) : null}
            </View>
            <Switch
              testID={`holiday-toggle-${entry.key}`}
              checked={observedByKey[entry.key] === true}
              onCheckedChange={next => handleToggle(entry.key, next)}
              disabled={!canEdit}
            />
          </View>
        ))}
      </Card>

      <View testID="custom-holiday-section" className="pt-8">
        <View className="pb-2">
          <Body weight="medium">{t('holidays.custom.sectionTitle')}</Body>
        </View>
        <Card className="overflow-hidden p-0">
          {customDays.length === 0 ? (
            <View className="px-4 py-3">
              <Small
                testID="custom-holiday-empty"
                className="text-muted-foreground"
              >
                {t('holidays.custom.empty')}
              </Small>
            </View>
          ) : (
            customDays.map((day, index) => (
              <View
                key={day.name}
                testID={`custom-holiday-row-${index}`}
                className="flex-row items-center justify-between gap-3 px-4 py-3"
              >
                <View className="flex-1 gap-1">
                  <Body weight="medium">{day.name}</Body>
                  <Small className="text-muted-foreground">
                    {day.dates
                      .map(date => formatDisplayDateWithYear(date))
                      .join(' · ')}
                  </Small>
                </View>
                {canEdit ? (
                  <View className="flex-row gap-1">
                    <Button
                      testID={`custom-holiday-edit-${index}`}
                      variant="ghost"
                      size="sm"
                      onPress={() => {
                        setEditingIndex(index);
                        setSheetVisible(true);
                      }}
                      accessibilityLabel={t('holidays.custom.editTitle')}
                    >
                      <Text>{t('holidays.custom.editTitle')}</Text>
                    </Button>
                    <Button
                      testID={`custom-holiday-delete-${index}`}
                      variant="ghost"
                      size="sm"
                      onPress={() => handleCustomDelete(index)}
                      accessibilityLabel={t('holidays.custom.deleteDay')}
                    >
                      <Text>{t('holidays.custom.deleteDay')}</Text>
                    </Button>
                  </View>
                ) : null}
              </View>
            ))
          )}
        </Card>
        {canEdit ? (
          <Button
            testID="custom-holiday-add"
            variant="outline"
            size="sm"
            className="mt-3"
            onPress={() => {
              setEditingIndex(null);
              setSheetVisible(true);
            }}
          >
            <Text>{t('holidays.custom.addButton')}</Text>
          </Button>
        ) : null}
      </View>

      <CustomHolidayEditSheet
        visible={sheetVisible}
        onDismiss={() => {
          setSheetVisible(false);
          setEditingIndex(null);
        }}
        onSave={handleCustomSave}
        initialName={editing?.name ?? ''}
        initialDates={editing?.dates ?? []}
        siblings={siblings}
      />
    </>
  );

  return (
    <SetupScreenShell
      testID="household-holidays-screen"
      title={t('holidays.manageTitle')}
      subtitle={t('holidays.subtitle')}
      ctaLabel={canEdit ? t('holidays.saveButton') : tCommon('done')}
      onCta={canEdit ? () => void handleSave() : () => router.back()}
      ctaDisabled={
        canEdit
          ? setHolidays.isPending || setCustomHolidays.isPending
          : undefined
      }
      onBack={() => router.back()}
      backLabel={tCommon('back')}
    >
      {rows}
    </SetupScreenShell>
  );
}
