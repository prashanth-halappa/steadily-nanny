/**
 * @module domains/settings/components/TimeSettingsScreen
 *
 * Settings -> Time & calendar (D29). Edits the caller's display timezone and
 * week-start preference. These are a presentation lens only — household
 * timesheets and Hours stay Monday business weeks.
 */

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { cn } from '@/lib/utils';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, Small } from '@/src/components/ui/typography';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { TimezonePickerSheet } from '@/src/domains/setup/components/TimezonePickerSheet';
import { findTimezoneOption } from '@/src/domains/setup/utils/timezones';
import { useUpdateTimeSettings } from '@/src/hooks/mutations/useUpdateTimeSettings';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { getDeviceTimeZone } from '@/src/lib/deviceTimeZone';
import { showSuccessToast } from '@/src/lib/toast';

const WEEK_START_OPTIONS = [0, 1, 2, 3, 4, 5, 6] as const;

export function TimeSettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation(['settings', 'schedule']);
  const profile = useUserProfile();
  const updateTimeSettings = useUpdateTimeSettings();

  const [timezone, setTimezone] = useState('UTC');
  const [weekStartsOn, setWeekStartsOn] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!profile.data || hydrated) return;
    setTimezone(profile.data.timezone ?? getDeviceTimeZone());
    setWeekStartsOn(profile.data.week_starts_on ?? 1);
    setHydrated(true);
  }, [profile.data, hydrated]);

  // Seed once when the profile has no timezone yet (D29).
  useEffect(() => {
    if (!profile.data || profile.data.timezone != null) return;
    updateTimeSettings.mutate({ timezone: getDeviceTimeZone() });
  }, [
    profile.data?.user_id,
    profile.data?.timezone,
    updateTimeSettings.mutate,
    profile.data,
  ]);

  const timezoneLabel = findTimezoneOption(timezone)?.label ?? timezone;

  const handleSave = async () => {
    try {
      await updateTimeSettings.mutateAsync({
        timezone,
        week_starts_on: weekStartsOn,
      });
    } catch {
      return;
    }
    showSuccessToast(t('settings:time.savedToast'));
    router.back();
  };

  if (profile.isLoading || !hydrated) {
    return (
      <View
        testID="time-settings-loading"
        className="flex-1 items-center justify-center bg-background"
      >
        <LoadingIndicator />
      </View>
    );
  }

  return (
    <SetupScreenShell
      testID="time-settings-screen"
      title={t('settings:time.title')}
      subtitle={t('settings:time.subtitle')}
      ctaLabel={t('settings:time.saveButton')}
      onCta={() => void handleSave()}
      ctaDisabled={updateTimeSettings.isPending}
    >
      <View className="gap-6">
        <View className="gap-2">
          <Body className="font-sora-medium">
            {t('settings:time.timezoneLabel')}
          </Body>
          <AnimatedPressable
            testID="time-settings-timezone"
            onPress={() => setSheetOpen(true)}
            className="rounded-lg border border-border bg-muted px-4 py-3"
          >
            <Body>{timezoneLabel}</Body>
          </AnimatedPressable>
          <Small className="text-muted-foreground">
            {t('settings:time.timezoneHint')}
          </Small>
        </View>

        <View className="gap-2">
          <Body className="font-sora-medium">
            {t('settings:time.weekStartsLabel')}
          </Body>
          <View className="flex-row flex-wrap gap-2">
            {WEEK_START_OPTIONS.map(day => (
              <AnimatedPressable
                key={day}
                testID={`time-settings-week-start-${day}`}
                onPress={() => setWeekStartsOn(day)}
              >
                <Small
                  className={cn(
                    'rounded-full border px-3 py-2',
                    day === weekStartsOn
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-foreground'
                  )}
                >
                  {t(`schedule:weekday.${day}`)}
                </Small>
              </AnimatedPressable>
            ))}
          </View>
          <Small className="text-muted-foreground">
            {t('settings:time.weekStartsHint')}
          </Small>
        </View>
      </View>

      <TimezonePickerSheet
        visible={sheetOpen}
        onDismiss={() => setSheetOpen(false)}
        selectedValue={timezone}
        onSelect={value => {
          setTimezone(value);
          setSheetOpen(false);
        }}
      />
    </SetupScreenShell>
  );
}
