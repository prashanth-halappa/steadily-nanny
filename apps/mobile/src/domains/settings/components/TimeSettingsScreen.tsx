/**
 * @module domains/settings/components/TimeSettingsScreen
 *
 * Settings -> Time & calendar (D29). Edits the caller's display timezone and
 * week-start preference, plus optional one-way device calendar sync.
 */

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { cn } from '@/lib/utils';
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
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Switch } from '@/src/components/ui/switch';
import { Text } from '@/src/components/ui/text';
import { Body, Small } from '@/src/components/ui/typography';
import {
  clearMarkedEventsDefault,
  getCalendarPermissions,
  requestCalendarPermissions,
  runDefaultCalendarSync,
  type WritableCalendar,
} from '@/src/domains/schedule/utils/calendarSyncNative';
import { CalendarPickerSheet } from '@/src/domains/settings/components/CalendarPickerSheet';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { TimezonePickerSheet } from '@/src/domains/setup/components/TimezonePickerSheet';
import { findTimezoneOption } from '@/src/domains/setup/utils/timezones';
import { useUpdateTimeSettings } from '@/src/hooks/mutations/useUpdateTimeSettings';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { getDeviceTimeZone } from '@/src/lib/deviceTimeZone';
import { showSuccessToast } from '@/src/lib/toast';
import { useCalendarSyncStore } from '@/src/store/calendarSyncStore';

const WEEK_START_OPTIONS = [0, 1, 2, 3, 4, 5, 6] as const;

function calendarLabelFor(cal: WritableCalendar): string {
  return `${cal.sourceName} · ${cal.title}`;
}

export function TimeSettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation(['settings', 'schedule']);
  const profile = useUserProfile();
  const updateTimeSettings = useUpdateTimeSettings();

  const enabled = useCalendarSyncStore(s => s.enabled);
  const calendarId = useCalendarSyncStore(s => s.calendarId);
  const calendarLabel = useCalendarSyncStore(s => s.calendarLabel);
  const setEnabled = useCalendarSyncStore(s => s.setEnabled);
  const setCalendar = useCalendarSyncStore(s => s.setCalendar);
  const disconnect = useCalendarSyncStore(s => s.disconnect);

  const [timezone, setTimezone] = useState('UTC');
  const [weekStartsOn, setWeekStartsOn] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
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

  const handleToggle = async (next: boolean) => {
    if (!next) {
      if (enabled && calendarId) {
        setDisconnectOpen(true);
        return;
      }
      disconnect();
      setPermissionDenied(false);
      return;
    }

    const existing = await getCalendarPermissions();
    let granted = existing.granted;
    if (!granted) {
      const requested = await requestCalendarPermissions();
      granted = requested.granted;
    }
    if (!granted) {
      setEnabled(false);
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);
    setPickerOpen(true);
  };

  const handleSelectCalendar = async (cal: WritableCalendar) => {
    const previousId = calendarId;
    if (previousId && previousId !== cal.id) {
      await clearMarkedEventsDefault(previousId);
    }
    const label = calendarLabelFor(cal);
    setCalendar(cal.id, label);
    setEnabled(true);
    setPickerOpen(false);
    showSuccessToast(t('settings:time.calendarSync.successToast', { label }));
    void runDefaultCalendarSync();
  };

  const handleConfirmDisconnect = async () => {
    const id = calendarId;
    setDisconnectOpen(false);
    if (id) {
      await clearMarkedEventsDefault(id);
    }
    disconnect();
    setPermissionDenied(false);
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
          <Body className="font-medium">
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
          <Body className="font-medium">
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
                    'rounded-chip border px-3 py-2',
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

        <View className="gap-2" testID="time-settings-calendar-sync">
          <View className="flex-row items-center justify-between gap-3">
            <Body className="flex-1 font-medium">
              {t('settings:time.calendarSync.toggleLabel')}
            </Body>
            <Switch
              testID="time-settings-calendar-sync-switch"
              checked={enabled}
              onCheckedChange={value => {
                void handleToggle(value);
              }}
            />
          </View>
          <Small className="text-muted-foreground">
            {t('settings:time.calendarSync.toggleHint')}
          </Small>

          {permissionDenied ? (
            <AnimatedPressable
              testID="time-settings-calendar-permission-denied"
              onPress={() => void Linking.openSettings()}
            >
              <Small className="text-destructive">
                {t('settings:time.calendarSync.permissionDeniedHint')}
              </Small>
              <Small className="text-primary">
                {t('settings:time.calendarSync.openSystemSettings')}
              </Small>
            </AnimatedPressable>
          ) : null}

          {enabled && calendarLabel ? (
            <AnimatedPressable
              testID="time-settings-chosen-calendar"
              onPress={() => setPickerOpen(true)}
              className="rounded-lg border border-border bg-muted px-4 py-3"
            >
              <Body>
                {t('settings:time.calendarSync.chosenCalendar', {
                  label: calendarLabel,
                })}
              </Body>
            </AnimatedPressable>
          ) : null}
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

      <CalendarPickerSheet
        visible={pickerOpen}
        onDismiss={() => {
          setPickerOpen(false);
          if (!calendarId) setEnabled(false);
        }}
        selectedCalendarId={calendarId}
        onSelect={cal => {
          void handleSelectCalendar(cal);
        }}
      />

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings:time.calendarSync.disconnectTitle', {
                label: calendarLabel ?? '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings:time.calendarSync.disconnectBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* Children MUST be wrapped in <Text>: these primitives feed a
                TextClassContext and a bare string child crashes RN with
                "Text strings must be rendered within a <Text> component."
                The test renderer does not enforce this — device only. */}
            <AlertDialogCancel testID="calendar-sync-disconnect-cancel">
              <Text>{t('settings:time.calendarSync.disconnectCancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              testID="calendar-sync-disconnect-confirm"
              onPress={() => {
                void handleConfirmDisconnect();
              }}
            >
              <Text>{t('settings:time.calendarSync.disconnectConfirm')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SetupScreenShell>
  );
}
