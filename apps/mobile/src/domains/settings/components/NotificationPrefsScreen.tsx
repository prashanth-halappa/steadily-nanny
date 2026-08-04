/**
 * @module domains/settings/components/NotificationPrefsScreen
 *
 * Settings → Notifications: quiet hours + per-type opt-outs. First write
 * seeds the prefs timezone from the device so quiet-hours evaluation is not
 * stuck on the UTC default.
 */

import {
  ALL_PUSH_NOTIFICATION_TYPES,
  type PushNotificationType,
} from '@steadily-nanny/shared-types';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Switch } from '@/src/components/ui/switch';
import { Text } from '@/src/components/ui/text';
import { Body, Small } from '@/src/components/ui/typography';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { useUpdateNotificationPrefs } from '@/src/hooks/mutations/useUpdateNotificationPrefs';
import { useNotificationPrefs } from '@/src/hooks/queries/useNotificationPrefs';
import { getDeviceTimeZone } from '@/src/lib/deviceTimeZone';
import { showSuccessToast } from '@/src/lib/toast';

const DEFAULT_QUIET_START = '22:00';
const DEFAULT_QUIET_END = '07:00';

const QUIET_START_OPTIONS = ['21:00', '22:00', '23:00'] as const;
const QUIET_END_OPTIONS = ['06:00', '07:00', '08:00'] as const;

export function NotificationPrefsScreen() {
  const router = useRouter();
  const { t } = useTranslation('settings');
  const prefsQuery = useNotificationPrefs();
  const updatePrefs = useUpdateNotificationPrefs();

  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState(DEFAULT_QUIET_START);
  const [quietHoursEnd, setQuietHoursEnd] = useState(DEFAULT_QUIET_END);
  const [disabledTypes, setDisabledTypes] = useState<PushNotificationType[]>(
    []
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!prefsQuery.data || hydrated) return;
    setQuietHoursEnabled(prefsQuery.data.quietHoursEnabled);
    setQuietHoursStart(prefsQuery.data.quietHoursStart ?? DEFAULT_QUIET_START);
    setQuietHoursEnd(prefsQuery.data.quietHoursEnd ?? DEFAULT_QUIET_END);
    setDisabledTypes(prefsQuery.data.disabledTypes);
    setHydrated(true);
  }, [prefsQuery.data, hydrated]);

  const toggleType = (type: PushNotificationType, enabled: boolean) => {
    setDisabledTypes(prev => {
      if (enabled) {
        return prev.filter(item => item !== type);
      }
      if (prev.includes(type)) return prev;
      return [...prev, type];
    });
  };

  const handleSave = async () => {
    // First write (and every save): populate IANA zone from the device so
    // quiet-hours evaluation is not stuck on the UTC default.
    try {
      await updatePrefs.mutateAsync({
        quietHoursEnabled,
        quietHoursStart,
        quietHoursEnd,
        disabledTypes,
        timezone: getDeviceTimeZone(),
      });
    } catch {
      return;
    }
    showSuccessToast(t('notificationPrefs.savedToast'));
    router.back();
  };

  if (prefsQuery.isLoading || !hydrated) {
    return (
      <View
        testID="notification-prefs-loading"
        className="flex-1 items-center justify-center bg-background"
      >
        <LoadingIndicator />
      </View>
    );
  }

  return (
    <SetupScreenShell
      testID="notification-prefs-screen"
      title={t('notificationPrefs.title')}
      subtitle={t('notificationPrefs.subtitle')}
      ctaLabel={t('notificationPrefs.saveButton')}
      onCta={() => void handleSave()}
      ctaDisabled={updatePrefs.isPending}
      onBack={() => router.back()}
      backLabel={t('notificationPrefs.back')}
    >
      <View className="gap-8">
        <View className="gap-3">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1 gap-1">
              <Body className="font-medium">
                {t('notificationPrefs.quietHoursLabel')}
              </Body>
              <Small className="text-muted-foreground">
                {t('notificationPrefs.quietHoursHint')}
              </Small>
            </View>
            <Switch
              testID="notification-prefs-quiet-hours"
              checked={quietHoursEnabled}
              onCheckedChange={setQuietHoursEnabled}
            />
          </View>

          {quietHoursEnabled ? (
            <View className="gap-4" testID="notification-prefs-quiet-window">
              <View className="gap-2">
                <Small className="text-muted-foreground">
                  {t('notificationPrefs.quietHoursStart')}
                </Small>
                <View className="flex-row flex-wrap gap-2">
                  {QUIET_START_OPTIONS.map(value => (
                    <AnimatedPressable
                      key={value}
                      testID={`notification-prefs-quiet-start-${value}`}
                      onPress={() => setQuietHoursStart(value)}
                      className={
                        value === quietHoursStart
                          ? 'rounded-chip border border-primary bg-primary/10 px-3 py-2'
                          : 'rounded-chip border border-border px-3 py-2'
                      }
                    >
                      <Small
                        className={
                          value === quietHoursStart
                            ? 'text-primary'
                            : 'text-foreground'
                        }
                      >
                        {value}
                      </Small>
                    </AnimatedPressable>
                  ))}
                </View>
              </View>
              <View className="gap-2">
                <Small className="text-muted-foreground">
                  {t('notificationPrefs.quietHoursEnd')}
                </Small>
                <View className="flex-row flex-wrap gap-2">
                  {QUIET_END_OPTIONS.map(value => (
                    <AnimatedPressable
                      key={value}
                      testID={`notification-prefs-quiet-end-${value}`}
                      onPress={() => setQuietHoursEnd(value)}
                      className={
                        value === quietHoursEnd
                          ? 'rounded-chip border border-primary bg-primary/10 px-3 py-2'
                          : 'rounded-chip border border-border px-3 py-2'
                      }
                    >
                      <Small
                        className={
                          value === quietHoursEnd
                            ? 'text-primary'
                            : 'text-foreground'
                        }
                      >
                        {value}
                      </Small>
                    </AnimatedPressable>
                  ))}
                </View>
              </View>
            </View>
          ) : null}
        </View>

        <View className="gap-3">
          <Body className="font-medium">
            {t('notificationPrefs.typesHeading')}
          </Body>
          <Small className="text-muted-foreground">
            {t('notificationPrefs.typesHint')}
          </Small>
          {ALL_PUSH_NOTIFICATION_TYPES.map(type => {
            const enabled = !disabledTypes.includes(type);
            return (
              <View
                key={type}
                className="flex-row items-center justify-between gap-3"
                testID={`notification-prefs-type-${type}`}
              >
                <Body className="flex-1">
                  {t(`notificationPrefs.types.${type}`)}
                </Body>
                <Switch
                  testID={`notification-prefs-type-switch-${type}`}
                  checked={enabled}
                  onCheckedChange={next => toggleType(type, next)}
                />
              </View>
            );
          })}
        </View>

        <AnimatedPressable
          testID="notification-prefs-os-settings"
          onPress={() => void Linking.openSettings()}
          className="rounded-lg border border-border px-4 py-3"
        >
          <Text className="text-primary">
            {t('notificationPrefs.openOsSettings')}
          </Text>
          <Small className="mt-1 text-muted-foreground">
            {t('notificationPrefs.openOsSettingsHint')}
          </Small>
        </AnimatedPressable>
      </View>
    </SetupScreenShell>
  );
}
