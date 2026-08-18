/**
 * @module domains/household/components/HouseholdHolidaysScreen
 *
 * Settings -> "Holidays". A parent picks which US federal holidays this
 * family observes; a nanny (or past member) can read the list but not
 * change it — the API is parents-write. ABSENT from the fetched rows
 * means NOT observed (playbook §2.9): never treat a missing key as on.
 *
 * HYDRATE-ONCE local state, ONE Save of all 11 toggles — not a PUT per
 * flip. Same hydrated-flag effect as `NotificationPrefsScreen`.
 */
import { usFederalHolidayDates } from '@steadily-nanny/shared-types/usFederalHolidays';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { InlineRetry } from '@/src/components/custom/InlineRetry';
import { BackButton } from '@/src/components/ui/back-button';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Switch } from '@/src/components/ui/switch';
import { Body, Small } from '@/src/components/ui/typography';
import { formatDisplayDateWithYear } from '@/src/domains/pay/utils/payArrangementForm';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useSetHouseholdHolidays } from '@/src/hooks/mutations/useSetHouseholdHolidays';
import { useHouseholdHolidays } from '@/src/hooks/queries/useHouseholdHolidays';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { showSuccessToast } from '@/src/lib/toast';

export function HouseholdHolidaysScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const { t: tCommon } = useTranslation('common');
  const { t: tErrors } = useTranslation('errors');
  const onboarding = useIsOnboarded();
  const householdId = onboarding.householdId;
  const holidaysQuery = useHouseholdHolidays(householdId);
  const setHolidays = useSetHouseholdHolidays(householdId ?? '');

  const catalog = usFederalHolidayDates(new Date().getFullYear());
  const canEdit =
    onboarding.role === SETUP_ROLES.PARENT && !onboarding.isPastMember;

  const [observedByKey, setObservedByKey] = useState<Record<string, boolean>>(
    {}
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!holidaysQuery.data || hydrated) return;
    const next: Record<string, boolean> = {};
    for (const entry of usFederalHolidayDates(new Date().getFullYear())) {
      const row = holidaysQuery.data.find(
        item => item.holiday_key === entry.key
      );
      next[entry.key] = row?.observed === true;
    }
    setObservedByKey(next);
    setHydrated(true);
  }, [holidaysQuery.data, hydrated]);

  const handleToggle = (key: string, next: boolean) => {
    if (!canEdit) return;
    setObservedByKey(prev => ({ ...prev, [key]: next }));
  };

  const handleSave = async () => {
    if (setHolidays.isPending || !canEdit) return;
    try {
      await setHolidays.mutateAsync({
        holidays: catalog.map(entry => ({
          holiday_key: entry.key,
          observed: observedByKey[entry.key] === true,
        })),
      });
    } catch {
      return;
    }
    showSuccessToast(t('holidays.savedToast'));
    router.back();
  };

  const backHeader = (
    <BackButton
      testID="household-holidays-back"
      onPress={() => router.back()}
      label={tCommon('back')}
    />
  );

  if (onboarding.status === 'loading' || holidaysQuery.isLoading) {
    return (
      <View
        testID="household-holidays-screen"
        className="flex-1 items-center justify-center bg-background"
      >
        <LoadingIndicator testID="household-holidays-loading" />
      </View>
    );
  }

  if (holidaysQuery.isError) {
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
            onRetry={() => void holidaysQuery.refetch()}
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
      {catalog.map(entry => (
        <View
          key={entry.key}
          className="flex-row items-center justify-between gap-3"
        >
          <View className="flex-1 gap-1">
            <Body weight="medium">{t(`holidays.names.${entry.key}`)}</Body>
            <Small className="text-muted-foreground">
              {formatDisplayDateWithYear(entry.date)}
            </Small>
          </View>
          <Switch
            testID={`holiday-toggle-${entry.key}`}
            checked={observedByKey[entry.key] === true}
            onCheckedChange={next => handleToggle(entry.key, next)}
            disabled={!canEdit}
          />
        </View>
      ))}
    </>
  );

  return (
    <SetupScreenShell
      testID="household-holidays-screen"
      title={t('holidays.manageTitle')}
      subtitle={t('holidays.subtitle')}
      ctaLabel={canEdit ? t('holidays.saveButton') : tCommon('done')}
      onCta={canEdit ? () => void handleSave() : () => router.back()}
      ctaDisabled={canEdit ? setHolidays.isPending : undefined}
      onBack={() => router.back()}
      backLabel={tCommon('back')}
    >
      {rows}
    </SetupScreenShell>
  );
}
