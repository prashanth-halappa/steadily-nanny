/**
 * @module domains/setup/components/ManageHouseholdScreen
 *
 * Post-onboarding entry point (Settings -> Household): until this screen,
 * `PATCH /households/:householdId` had zero mobile callers — a household's
 * name, time zone, address, and approval policy were all set once at
 * creation and permanently unchangeable afterward. The urgent case:
 * `households.timezone` drives `local_date` derivation for every shift and
 * every `timesheets.week_start` boundary — a household that picked wrong at
 * signup had no way to correct it.
 *
 * PARENT-ONLY, checked here via server-derived `useIsOnboarded().role` (the
 * same choke point `TodayScreen` reads, never local `setupProgress` wizard
 * state) — a defense-in-depth check independent of the Settings tab's own
 * role-gated link, since an expo-router route is reachable by URL regardless
 * of which links are shown.
 *
 * Only the CHANGED fields are ever sent (`buildDiff`) — `UpdateHouseholdSchema`
 * is a PATCH-partial requiring at least one field, and diffing means the
 * mutation call itself is legible evidence of what actually changed (see this
 * screen's test).
 *
 * Timezone gets its own confirmation step (`AlertDialog`, not a bare
 * `<Modal>` — GOLDEN-FIXES #1): changing it is a real, going-forward-only
 * effect (verified by reading `schedulePatternCommandService.create()` and
 * `shifts.timezone` in migration 015 — both freeze the zone they were
 * authored in, so nothing already recorded is reinterpreted), but "which
 * week is 'this week'" for any NEW schedule or the Hours screen's default
 * view changes the moment this saves. The copy says exactly that, not more.
 */

import type {
  HouseholdApprovalMode,
  HouseholdApprovalScope,
  UpdateHouseholdInput,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import {
  HOUSEHOLD_APPROVAL_MODES,
  HOUSEHOLD_APPROVAL_SCOPES,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
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
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Body, Small } from '@/src/components/ui/typography';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { findTimezoneOption } from '@/src/domains/setup/utils/timezones';
import { useUpdateHousehold } from '@/src/hooks/mutations/useUpdateHousehold';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { showSuccessToast } from '@/src/lib/toast';
import { SetupScreenShell } from './SetupScreenShell';
import { TimezonePickerSheet } from './TimezonePickerSheet';

const APPROVAL_MODE_OPTIONS: readonly HouseholdApprovalMode[] = [
  HOUSEHOLD_APPROVAL_MODES.EITHER,
  HOUSEHOLD_APPROVAL_MODES.ASK_OTHER,
  HOUSEHOLD_APPROVAL_MODES.OWNER_ONLY,
];

const APPROVAL_SCOPE_OPTIONS: readonly HouseholdApprovalScope[] = [
  HOUSEHOLD_APPROVAL_SCOPES.ALL,
  HOUSEHOLD_APPROVAL_SCOPES.SHORT_NOTICE_AND_CANCELLATIONS,
];

const MAX_APPROVAL_TIMEOUT_MINUTES = 10080;
const MAX_SHORT_NOTICE_HOURS = 336;
const MAX_CANCELLATION_PAID_WITHIN_HOURS = 336;

function isValidBoundedInt(value: string, max: number): boolean {
  if (!/^\d+$/.test(value.trim())) return false;
  const n = Number(value.trim());
  return Number.isInteger(n) && n >= 0 && n <= max;
}

export function ManageHouseholdScreen() {
  const { t } = useTranslation('household');
  const onboarding = useIsOnboarded();
  const households = useHouseholds();
  const updateHousehold = useUpdateHousehold();

  const household =
    households.data?.find(h => h.id === onboarding.householdId) ?? null;

  const [name, setName] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [timezone, setTimezone] = useState('');
  const [approvalMode, setApprovalMode] = useState<HouseholdApprovalMode>(
    HOUSEHOLD_APPROVAL_MODES.EITHER
  );
  const [approvalScope, setApprovalScope] = useState<HouseholdApprovalScope>(
    HOUSEHOLD_APPROVAL_SCOPES.ALL
  );
  const [approvalTimeoutMinutes, setApprovalTimeoutMinutes] = useState('0');
  const [shortNoticeHours, setShortNoticeHours] = useState('0');
  const [cancellationPaidWithinHours, setCancellationPaidWithinHours] =
    useState('0');
  const [isTimezoneSheetOpen, setIsTimezoneSheetOpen] = useState(false);
  const [isTimezoneConfirmOpen, setIsTimezoneConfirmOpen] = useState(false);

  // Seed local form state from the server ONCE, the first time the household
  // loads — not on every `household` object change, so an in-flight
  // background refetch never clobbers an edit in progress. After a
  // successful save the refetched household matches what the form already
  // holds, so the diff below naturally goes empty and Save disables — no
  // second snapshot needed.
  const hasSeededRef = useRef(false);
  useEffect(() => {
    if (!household || hasSeededRef.current) return;
    hasSeededRef.current = true;
    setName(household.name);
    setAddressLine(household.address_line ?? '');
    setTimezone(household.timezone);
    setApprovalMode(household.approval_mode);
    setApprovalScope(household.approval_scope);
    setApprovalTimeoutMinutes(String(household.approval_timeout_minutes));
    setShortNoticeHours(String(household.short_notice_hours));
    setCancellationPaidWithinHours(
      String(household.cancellation_paid_within_hours)
    );
  }, [household]);

  const loadingShell = (
    <SetupScreenShell
      testID="manage-household-screen"
      title={t('householdSettings.manageTitle')}
      ctaLabel={t('householdSettings.saveButton')}
      onCta={() => {}}
      ctaDisabled
    >
      <LoadingIndicator />
    </SetupScreenShell>
  );

  // Defense in depth: the Settings tab already gates this link to parents,
  // but an expo-router route is reachable by URL regardless — never render
  // the form for a non-parent even if they navigate here directly.
  if (onboarding.status === 'loading') {
    return loadingShell;
  }
  if (onboarding.role !== SETUP_ROLES.PARENT) {
    return null;
  }
  if (!household) {
    return loadingShell;
  }

  const isNumericFieldsValid =
    isValidBoundedInt(approvalTimeoutMinutes, MAX_APPROVAL_TIMEOUT_MINUTES) &&
    isValidBoundedInt(shortNoticeHours, MAX_SHORT_NOTICE_HOURS) &&
    isValidBoundedInt(
      cancellationPaidWithinHours,
      MAX_CANCELLATION_PAID_WITHIN_HOURS
    );
  const isValid =
    name.trim().length > 0 &&
    timezone.trim().length > 0 &&
    isNumericFieldsValid;

  const diff: UpdateHouseholdInput = {};
  if (isValid) {
    if (name.trim() !== household.name) diff.name = name.trim();
    const trimmedAddress = addressLine.trim();
    if (trimmedAddress !== (household.address_line ?? '')) {
      diff.address_line = trimmedAddress;
    }
    if (timezone !== household.timezone) diff.timezone = timezone;
    if (approvalMode !== household.approval_mode) {
      diff.approval_mode = approvalMode;
    }
    if (approvalScope !== household.approval_scope) {
      diff.approval_scope = approvalScope;
    }
    const timeoutNum = Number(approvalTimeoutMinutes.trim());
    if (timeoutNum !== household.approval_timeout_minutes) {
      diff.approval_timeout_minutes = timeoutNum;
    }
    const shortNoticeNum = Number(shortNoticeHours.trim());
    if (shortNoticeNum !== household.short_notice_hours) {
      diff.short_notice_hours = shortNoticeNum;
    }
    const cancellationNum = Number(cancellationPaidWithinHours.trim());
    if (cancellationNum !== household.cancellation_paid_within_hours) {
      diff.cancellation_paid_within_hours = cancellationNum;
    }
  }
  const isDirty = Object.keys(diff).length > 0;
  const isTimezoneChanged = 'timezone' in diff;

  const submitDiff = async () => {
    try {
      await updateHousehold.mutateAsync({
        householdId: household.id,
        input: diff,
      });
      showSuccessToast(t('householdSettings.savedToast'));
    } catch {
      // useUpdateHousehold's onError already surfaces a toast.
    }
  };

  const selectedTimezoneLabel = findTimezoneOption(timezone)?.label ?? timezone;

  const saveDisabled = !isValid || !isDirty || updateHousehold.isPending;

  const handleCta = () => {
    if (saveDisabled) return;
    // Timezone changes get a confirmation step (below) instead of saving
    // immediately — every other field saves straight away.
    if (isTimezoneChanged) {
      setIsTimezoneConfirmOpen(true);
      return;
    }
    void submitDiff();
  };

  return (
    <SetupScreenShell
      testID="manage-household-screen"
      title={t('householdSettings.manageTitle')}
      subtitle={t('householdSettings.manageSubtitle')}
      ctaLabel={t('householdSettings.saveButton')}
      onCta={handleCta}
      ctaDisabled={saveDisabled}
    >
      <View className="gap-2">
        <Label>{t('householdSettings.nameLabel')}</Label>
        <Input
          testID="household-name-input"
          accessibilityLabel={t('householdSettings.nameLabel')}
          value={name}
          onChangeText={setName}
          placeholder={t('householdSettings.namePlaceholder')}
        />
      </View>

      <View className="gap-2">
        <Label>{t('householdSettings.addressLabel')}</Label>
        <Input
          testID="household-address-input"
          accessibilityLabel={t('householdSettings.addressLabel')}
          value={addressLine}
          onChangeText={setAddressLine}
          placeholder={t('householdSettings.addressPlaceholder')}
        />
      </View>

      <View className="gap-2">
        <Label>{t('householdSettings.timezoneLabel')}</Label>
        <AnimatedPressable
          testID="household-timezone-trigger"
          onPress={() => setIsTimezoneSheetOpen(true)}
        >
          <View className="flex-row items-center justify-between rounded-2xl border border-input bg-background px-4 py-3">
            <Body>{selectedTimezoneLabel}</Body>
            <Small className="text-primary">
              {t('householdSettings.timezoneChangeButton')}
            </Small>
          </View>
        </AnimatedPressable>
        <Small className="text-muted-foreground">
          {t('householdSettings.timezoneWarning')}
        </Small>
      </View>

      <View className="gap-2">
        <Label>{t('householdSettings.approvalModeLabel')}</Label>
        <View className="flex-row flex-wrap gap-2">
          {APPROVAL_MODE_OPTIONS.map(mode => (
            <AnimatedPressable
              key={mode}
              testID={`household-approval-mode-${mode}`}
              onPress={() => setApprovalMode(mode)}
            >
              <Small
                className={cn(
                  'rounded-full border px-4 py-2',
                  mode === approvalMode
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-foreground'
                )}
              >
                {t(`householdSettings.approvalMode.${mode}`)}
              </Small>
            </AnimatedPressable>
          ))}
        </View>
      </View>

      <View className="gap-2">
        <Label>{t('householdSettings.approvalScopeLabel')}</Label>
        <View className="flex-row flex-wrap gap-2">
          {APPROVAL_SCOPE_OPTIONS.map(scope => (
            <AnimatedPressable
              key={scope}
              testID={`household-approval-scope-${scope}`}
              onPress={() => setApprovalScope(scope)}
            >
              <Small
                className={cn(
                  'rounded-full border px-4 py-2',
                  scope === approvalScope
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-foreground'
                )}
              >
                {t(`householdSettings.approvalScope.${scope}`)}
              </Small>
            </AnimatedPressable>
          ))}
        </View>
      </View>

      <View className="gap-2">
        <Label>{t('householdSettings.approvalTimeoutLabel')}</Label>
        <Input
          testID="household-approval-timeout-input"
          accessibilityLabel={t('householdSettings.approvalTimeoutLabel')}
          value={approvalTimeoutMinutes}
          onChangeText={setApprovalTimeoutMinutes}
          keyboardType="number-pad"
        />
      </View>

      <View className="gap-2">
        <Label>{t('householdSettings.shortNoticeHoursLabel')}</Label>
        <Input
          testID="household-short-notice-hours-input"
          accessibilityLabel={t('householdSettings.shortNoticeHoursLabel')}
          value={shortNoticeHours}
          onChangeText={setShortNoticeHours}
          keyboardType="number-pad"
        />
      </View>

      <View className="gap-2">
        <Label>{t('householdSettings.cancellationPaidWithinHoursLabel')}</Label>
        <Input
          testID="household-cancellation-paid-within-hours-input"
          accessibilityLabel={t(
            'householdSettings.cancellationPaidWithinHoursLabel'
          )}
          value={cancellationPaidWithinHours}
          onChangeText={setCancellationPaidWithinHours}
          keyboardType="number-pad"
        />
      </View>

      {/* Controlled, no Trigger — opened programmatically from the shell's
          pinned CTA (`handleCta`) only when the diff includes a timezone
          change, so every other field still saves on a single tap. */}
      <AlertDialog
        open={isTimezoneConfirmOpen}
        onOpenChange={setIsTimezoneConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('householdSettings.timezoneConfirmTitle', {
                zone: selectedTimezoneLabel,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('householdSettings.timezoneConfirmBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Text>{t('householdSettings.timezoneConfirmCancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              testID="household-timezone-confirm"
              onPress={() => {
                setIsTimezoneConfirmOpen(false);
                void submitDiff();
              }}
            >
              <Text>{t('householdSettings.timezoneConfirmConfirm')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TimezonePickerSheet
        visible={isTimezoneSheetOpen}
        onDismiss={() => setIsTimezoneSheetOpen(false)}
        selectedValue={timezone}
        onSelect={value => {
          setTimezone(value);
          setIsTimezoneSheetOpen(false);
        }}
      />
    </SetupScreenShell>
  );
}
