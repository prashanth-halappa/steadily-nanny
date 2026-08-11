/**
 * @module domains/settings/components/NotificationPrefsScreen
 *
 * Settings → Notifications: quiet hours + per-type opt-outs. First write
 * seeds the prefs timezone from the device so quiet-hours evaluation is not
 * stuck on the UTC default.
 */

import {
  ALL_PUSH_NOTIFICATION_TYPES,
  PUSH_TYPE_AUDIENCE,
  type PushAudience,
  type PushNotificationType,
} from '@steadily-nanny/shared-types';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { useElevation } from '@/lib/design-tokens/elevation';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Switch } from '@/src/components/ui/switch';
import { Body, Small } from '@/src/components/ui/typography';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useUpdateNotificationPrefs } from '@/src/hooks/mutations/useUpdateNotificationPrefs';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useNotificationPrefs } from '@/src/hooks/queries/useNotificationPrefs';
import { getDeviceTimeZone } from '@/src/lib/deviceTimeZone';
import { showSuccessToast } from '@/src/lib/toast';

const DEFAULT_QUIET_START = '22:00';
const DEFAULT_QUIET_END = '07:00';

// A12 (extended, §1.5): no UI-reachable quiet window may swallow a whole
// recurring digest window. `cover_ask_reminder` fires in `[18:00, 22:00)`
// (loses at most its last tick to a 21:00 start); `shift_no_show_digest`
// fires in `[07:00, 10:00)` (loses at most its first tick to an 08:00 end);
// `uncovered_care_digest` fires in `[18:00, 21:00)`. The rule: any new
// recurring window must be at least 3 hours wide and must not be fully
// contained in `[21:00, 08:00)` — check new options against all three
// windows before adding one.
const QUIET_START_OPTIONS = ['21:00', '22:00', '23:00'] as const;
const QUIET_END_OPTIONS = ['06:00', '07:00', '08:00'] as const;

type NotificationGroup = 'schedule' | 'hoursAndPay' | 'household';

const PUSH_TYPE_GROUP: Record<PushNotificationType, NotificationGroup> = {
  carer_time_off_conflict: 'schedule',
  change_request_accepted: 'schedule',
  change_request_declined: 'schedule',
  change_request_expired: 'schedule',
  change_request_withdrawn: 'schedule',
  clock_out_reminder: 'hoursAndPay',
  co_parent_action_fyi: 'household',
  cover_ask_reminder: 'schedule',
  expense_approved: 'hoursAndPay',
  expense_rejected: 'hoursAndPay',
  expense_submitted: 'hoursAndPay',
  extra_shift_proposed: 'schedule',
  handoff_note_added: 'schedule',
  household_closure_changed: 'schedule',
  invite_redeemed: 'household',
  parent_covering: 'schedule',
  payment_corrected: 'hoursAndPay',
  payment_recorded: 'hoursAndPay',
  pay_terms_backdated: 'hoursAndPay',
  pay_terms_disagreed: 'hoursAndPay',
  pay_terms_scheduled_change_cancelled: 'hoursAndPay',
  pay_terms_set: 'hoursAndPay',
  pto_marked_paid: 'hoursAndPay',
  pto_usage_reversed: 'hoursAndPay',
  reimbursement_settled: 'hoursAndPay',
  running_late: 'schedule',
  schedule_pattern_amended: 'schedule',
  schedule_pattern_responded: 'schedule',
  schedule_pattern_sent: 'schedule',
  shift_cancelled: 'schedule',
  shift_change_requested: 'schedule',
  shift_confirmed: 'schedule',
  shift_declined: 'schedule',
  shift_needs_reconfirm: 'schedule',
  shift_no_show: 'schedule',
  shift_no_show_digest: 'schedule',
  shift_reminder: 'schedule',
  timesheet_approved: 'hoursAndPay',
  timesheet_awaiting_approval: 'hoursAndPay',
  timesheet_note_added: 'hoursAndPay',
  timesheet_queried: 'hoursAndPay',
  timesheet_query_withdrawn: 'hoursAndPay',
  timesheet_reopened: 'hoursAndPay',
  timesheet_submitted: 'hoursAndPay',
  time_off_requested: 'schedule',
  uncovered_care_detected: 'schedule',
  uncovered_care_digest: 'schedule',
};

const GROUP_ORDER: NotificationGroup[] = [
  'schedule',
  'hoursAndPay',
  'household',
];

const GROUP_I18N_KEY: Record<NotificationGroup, string> = {
  schedule: 'notificationPrefs.groups.schedule',
  hoursAndPay: 'notificationPrefs.groups.hoursAndPay',
  household: 'notificationPrefs.groups.household',
};

function audiencesForRole(
  role: ReturnType<typeof useIsOnboarded>['role']
): PushAudience[] {
  if (role === SETUP_ROLES.NANNY) return ['carer', 'both', 'any'];
  if (role === SETUP_ROLES.PARENT || role === SETUP_ROLES.HELPER) {
    return ['parent', 'both', 'any'];
  }
  return ['parent', 'carer', 'both', 'any'];
}

function isTypeVisibleForRole(
  type: PushNotificationType,
  role: ReturnType<typeof useIsOnboarded>['role']
): boolean {
  return audiencesForRole(role).includes(PUSH_TYPE_AUDIENCE[type]);
}

export function NotificationPrefsScreen() {
  const router = useRouter();
  const elevation = useElevation();
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const onboarding = useIsOnboarded();
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

  const visibleTypes = ALL_PUSH_NOTIFICATION_TYPES.filter(type =>
    isTypeVisibleForRole(type, onboarding.role)
  );
  const typesByGroup = GROUP_ORDER.map(group => ({
    group,
    types: visibleTypes.filter(type => PUSH_TYPE_GROUP[type] === group),
  })).filter(section => section.types.length > 0);

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
      backLabel={tCommon('back')}
    >
      <View className="gap-8">
        <View className="gap-3">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1 gap-1">
              <Body weight="medium">
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

        <View className="gap-6">
          <Body weight="medium">{t('notificationPrefs.typesHeading')}</Body>
          <Small className="text-muted-foreground">
            {t('notificationPrefs.typesHint')}
          </Small>
          {typesByGroup.map(({ group, types }) => (
            <View
              key={group}
              className="gap-3"
              testID={`notification-prefs-group-${group}`}
            >
              <Body weight="medium">{t(GROUP_I18N_KEY[group])}</Body>
              {types.map(type => {
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
          ))}
        </View>

        <AnimatedPressable
          testID="notification-prefs-os-settings"
          onPress={() => void Linking.openSettings()}
        >
          <View className="rounded-row bg-card px-4 py-3" style={elevation.row}>
            <Body className="text-primary">
              {t('notificationPrefs.openOsSettings')}
            </Body>
            <Small className="mt-1 text-muted-foreground">
              {t('notificationPrefs.openOsSettingsHint')}
            </Small>
          </View>
        </AnimatedPressable>
      </View>
    </SetupScreenShell>
  );
}
