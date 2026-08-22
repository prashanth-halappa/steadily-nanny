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
 * Country reuses that same confirm machinery: the server drops holiday
 * toggles whose key does not exist in the new country's pack and seeds the
 * new one, so the family's holiday list is replaced — that must be
 * consented to, not sprung.
 *
 * LEAVING (pay-loop wave): the mirror image of the per-row Remove below — a member
 * taking THEMSELVES out. Offered only when the viewer's own membership is not
 * `owner`, read from the same server-derived members list the Remove rows use
 * rather than from `onboarding.role`, which collapses `owner` and `parent`
 * into one `SetupRole` and so cannot tell the un-leavable owner from a
 * co-parent. The server refuses an owner anyway (403 CANNOT_LEAVE_AS_OWNER);
 * hiding the action is so nobody is offered a door that never opens.
 *
 * D3: member removal reuses the same `AlertDialog` confirm pattern for its
 * own destructive action (unlike delete-account's `BottomSheetBase` — there
 * is no text input here, so no keyboard to avoid). The Remove action is
 * gated per-row rather than by a separate role check: this whole screen is
 * already parent-only, so it only has to hide on the owner's own row (the
 * un-removable last-parent) and on the viewer's own row (removing yourself
 * is a different feature — "leave household" — not this PATCH).
 */

import {
  HOLIDAY_COUNTRIES,
  type HolidayCountry,
} from '@steadily-nanny/shared-types/holidayPacks';
import type {
  HouseholdApprovalMode,
  HouseholdApprovalScope,
  HouseholdMember,
  UpdateHouseholdInput,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import {
  HOUSEHOLD_APPROVAL_MODES,
  HOUSEHOLD_APPROVAL_SCOPES,
  HOUSEHOLD_ROLES,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';
import { RestrictedActionButton } from '@/src/components/custom/RestrictedActionButton';
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
import { buttonVariants } from '@/src/components/ui/button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { FieldLabel } from '@/src/components/ui/field-label';
import { Input } from '@/src/components/ui/input';
import { ListGroup } from '@/src/components/ui/list-group';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Body, Small } from '@/src/components/ui/typography';
import { CurrencySelect } from '@/src/domains/pay/components/CurrencySelect';
import { PaySetupPromptCard } from '@/src/domains/pay/components/PaySetupPromptCard';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { isParentEditorRole } from '@/src/domains/setup/types';
import { findTimezoneOption } from '@/src/domains/setup/utils/timezones';
import { findUsStateOption } from '@/src/domains/setup/utils/usStates';
import { useLeaveHousehold } from '@/src/hooks/mutations/useLeaveHousehold';
import { useRemoveMember } from '@/src/hooks/mutations/useRemoveMember';
import { useUpdateHousehold } from '@/src/hooks/mutations/useUpdateHousehold';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { getDeviceCurrency } from '@/src/lib/deviceLocale';
import { showSuccessToast } from '@/src/lib/toast';
import { useAuthStore } from '@/src/store/auth';
import { CountryPickerSheet, countryDisplayName } from './CountryPickerSheet';
import { JurisdictionPickerSheet } from './JurisdictionPickerSheet';
import { SetupScreenShell } from './SetupScreenShell';
import { TimezonePickerSheet } from './TimezonePickerSheet';

const APPROVAL_MODE_OPTIONS: readonly HouseholdApprovalMode[] = [
  HOUSEHOLD_APPROVAL_MODES.EITHER,
  HOUSEHOLD_APPROVAL_MODES.OWNER_ONLY,
];

const APPROVAL_SCOPE_OPTIONS: readonly HouseholdApprovalScope[] = [
  HOUSEHOLD_APPROVAL_SCOPES.ALL,
  HOUSEHOLD_APPROVAL_SCOPES.SHORT_NOTICE_AND_CANCELLATIONS,
];

const MAX_SHORT_NOTICE_HOURS = 336;
const MAX_CANCELLATION_PAID_WITHIN_HOURS = 336;

function isValidBoundedInt(value: string, max: number): boolean {
  if (!/^\d+$/.test(value.trim())) return false;
  const n = Number(value.trim());
  return Number.isInteger(n) && n >= 0 && n <= max;
}

const WEEK_START_OPTIONS = [0, 1, 2, 3, 4, 5, 6] as const;

function isHolidayCountry(value: string): value is HolidayCountry {
  return value === HOLIDAY_COUNTRIES.US || value === HOLIDAY_COUNTRIES.CA;
}

/** True for a 409 whose `metadata.reason` is the household domain's week-start lock. */
function isWeekStartLockedError(error: unknown): boolean {
  const err = error as {
    response?: {
      status?: number;
      data?: { error?: { metadata?: { reason?: string } } };
    };
  };
  return (
    err?.response?.status === 409 &&
    err.response?.data?.error?.metadata?.reason === 'WEEK_START_LOCKED'
  );
}

export function ManageHouseholdScreen() {
  const router = useRouter();
  const { t } = useTranslation(['household', 'schedule']);
  const { t: tCommon } = useTranslation('common');
  const { t: tSettings } = useTranslation('settings');
  const onboarding = useIsOnboarded();
  const households = useHouseholds();
  const updateHousehold = useUpdateHousehold();
  const currentUserId = useAuthStore(s => s.session?.user?.id);

  const household =
    households.data?.find(h => h.id === onboarding.householdId) ?? null;
  // TIER0-CX-SPEC.md §2 "First-time setup", entry point 1: one prompt card
  // per active nanny with no pay arrangement. `PaySetupPromptCard` itself
  // decides (per carer) whether it has anything to say — see its own header
  // comment for why the per-carer hook call has to live in its own
  // component instance rather than a hook called inside this `.map`.
  const members = useHouseholdMembers(household?.id ?? null);
  const activeNannies = (members.data ?? []).filter(
    m => m.role === 'nanny' && m.status === 'active'
  );
  const activeMembers = (members.data ?? []).filter(m => m.status === 'active');
  const removeMember = useRemoveMember(household?.id ?? '');
  const leaveHousehold = useLeaveHousehold();
  const [memberToRemove, setMemberToRemove] = useState<HouseholdMember | null>(
    null
  );
  const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false);

  const [name, setName] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [timezone, setTimezone] = useState('');
  const [currency, setCurrency] = useState('');
  const [country, setCountry] = useState<string>(HOLIDAY_COUNTRIES.US);
  const [jurisdiction, setJurisdiction] = useState<string | null>(null);
  const [weekStartsOn, setWeekStartsOn] = useState(1);
  // T1: attempt-and-refuse — the client has no cheap "does a timesheet
  // exist" signal (useWeekTimesheet lists by week only), so the row starts
  // editable and locks only once the server actually refuses a change.
  const [weekStartLocked, setWeekStartLocked] = useState(false);
  const [approvalMode, setApprovalMode] = useState<HouseholdApprovalMode>(
    HOUSEHOLD_APPROVAL_MODES.EITHER
  );
  const [approvalScope, setApprovalScope] = useState<HouseholdApprovalScope>(
    HOUSEHOLD_APPROVAL_SCOPES.ALL
  );
  const [shortNoticeHours, setShortNoticeHours] = useState('0');
  const [cancellationPaidWithinHours, setCancellationPaidWithinHours] =
    useState('0');
  const [isTimezoneSheetOpen, setIsTimezoneSheetOpen] = useState(false);
  const [isTimezoneConfirmOpen, setIsTimezoneConfirmOpen] = useState(false);
  const [isCountrySheetOpen, setIsCountrySheetOpen] = useState(false);
  const [isJurisdictionSheetOpen, setIsJurisdictionSheetOpen] = useState(false);

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
    // `?? ''` seeds the placeholder for a DRAFT household's null name (093
    // §4.2). Empty can never be SAVED back over a real name: `isValid`
    // requires `name.trim().length > 0`, and the diff below only builds at
    // all when `isValid` — so an untouched empty field leaves Save disabled.
    setName(household.name ?? '');
    setAddressLine(household.address_line ?? '');
    setTimezone(household.timezone);
    // `?? getDeviceCurrency()` is defensive, not the normal path: every real
    // household carries `currency` (DB-required, backfilled). It only fires
    // against a fixture/server that predates the field, so seeding never
    // crashes `CurrencySelect` on an empty value.
    setCurrency(household.currency ?? getDeviceCurrency());
    setCountry(household.country ?? HOLIDAY_COUNTRIES.US);
    setJurisdiction(household.jurisdiction ?? null);
    setWeekStartsOn(household.week_starts_on ?? 1);
    setApprovalMode(household.approval_mode);
    setApprovalScope(household.approval_scope);
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
      onBack={() => router.back()}
      backLabel={tCommon('back')}
    >
      <LoadingIndicator />
    </SetupScreenShell>
  );

  // Defense in depth: the Settings tab already gates this link to parents,
  // but an expo-router route is reachable by URL regardless — never render
  // the form for a non-parent even if they navigate here directly. A bare
  // `null` used to leave a deep-linked nanny/helper staring at a blank
  // screen with no message and no way back — see TimeOffScreen's
  // `time-off-not-available` state, the pattern this mirrors.
  if (onboarding.status === 'loading') {
    return loadingShell;
  }
  if (!isParentEditorRole(onboarding.role)) {
    return (
      <View
        testID="manage-household-not-available"
        className="flex-1 bg-background"
      >
        <View
          style={{
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
          }}
        >
          <BackButton
            testID="manage-household-not-available-back"
            onPress={() => router.back()}
            label={tCommon('back')}
          />
        </View>
        <View
          className="mt-8"
          style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
        >
          <EmptyState
            variant="inline"
            title={t('householdSettings.notAvailableTitle')}
            description={t('householdSettings.notAvailableDescription')}
          />
        </View>
      </View>
    );
  }
  if (!household) {
    return loadingShell;
  }

  const isNumericFieldsValid =
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
    const householdCurrency = household.currency ?? getDeviceCurrency();
    if (currency !== householdCurrency) diff.currency = currency;
    const householdCountry = household.country ?? HOLIDAY_COUNTRIES.US;
    if (country !== householdCountry && isHolidayCountry(country)) {
      diff.country = country;
    }
    const householdJurisdiction = household.jurisdiction ?? null;
    // `households.jurisdiction` is a US state code. Never send it with a
    // country change, and never send it when the form country is not US —
    // a Canadian family must not be able to pick "California" into it.
    if (
      !('country' in diff) &&
      jurisdiction !== householdJurisdiction &&
      country === HOLIDAY_COUNTRIES.US
    ) {
      diff.jurisdiction = jurisdiction;
    }
    const householdWeekStartsOn = household.week_starts_on ?? 1;
    if (weekStartsOn !== householdWeekStartsOn) {
      diff.week_starts_on = weekStartsOn;
    }
    if (approvalMode !== household.approval_mode) {
      diff.approval_mode = approvalMode;
    }
    if (approvalScope !== household.approval_scope) {
      diff.approval_scope = approvalScope;
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
  const isCountryChanged = 'country' in diff;

  const submitDiff = async () => {
    try {
      await updateHousehold.mutateAsync({
        householdId: household.id,
        input: diff,
      });
      showSuccessToast(t('householdSettings.savedToast'));
    } catch (error) {
      // useUpdateHousehold's onError already surfaces a generic toast. T1:
      // the client has no cheap up-front signal that a timesheet exists, so
      // this is the one place that actually learns the row is locked —
      // surface the specific copy and keep it locked from here on.
      if (isWeekStartLockedError(error)) {
        setWeekStartLocked(true);
      }
    }
  };

  // The viewer's OWN row, from the same list the Remove rows are built from.
  const ownMembership =
    activeMembers.find(m => m.user_id === currentUserId) ?? null;
  const canLeave =
    ownMembership !== null && ownMembership.role !== HOUSEHOLD_ROLES.OWNER;

  const handleConfirmLeave = async () => {
    setIsLeaveConfirmOpen(false);
    const name = household.name;
    try {
      await leaveHousehold.mutateAsync(household.id);
    } catch {
      // useLeaveHousehold's onError already named the refusal (owner /
      // clocked in) in a toast, and staying on this screen is the honest
      // outcome — nothing changed.
      return;
    }
    showSuccessToast(t('householdSettings.leftToast', { name }));
    // Back through the ENTRY ROUTER rather than a guessed destination: after
    // leaving, "where does this user belong" depends on whether they have
    // another active household, a past-household-only history, or nothing at
    // all — and `app/index.tsx` is the one place that answers that, from the
    // memberships the mutation just invalidated. `replace`, not `push`: the
    // household settings screen for a household you are no longer in must
    // not be reachable with a back gesture.
    router.replace('/' as Href);
  };

  const canRemoveMember = (member: HouseholdMember): boolean =>
    member.role !== HOUSEHOLD_ROLES.OWNER && member.user_id !== currentUserId;

  // Captures the display name BEFORE clearing `memberToRemove` and firing the
  // mutation: once removal succeeds the members query refetches without that
  // row, so there is nothing left to read the name from at that point.
  const handleConfirmRemove = () => {
    if (!memberToRemove) return;
    const memberId = memberToRemove.id;
    const name = resolveCarerName(
      memberToRemove,
      t(`settings:role.${memberToRemove.role}`)
    );
    setMemberToRemove(null);
    removeMember.mutate(memberId, {
      onSuccess: () => {
        showSuccessToast(
          t('householdSettings.removeMemberSuccessToast', { name })
        );
      },
    });
  };

  const selectedTimezoneLabel = findTimezoneOption(timezone)?.label ?? timezone;
  const selectedCountryLabel = countryDisplayName(country);
  const selectedJurisdictionLabel = jurisdiction
    ? (findUsStateOption(jurisdiction)?.label ?? jurisdiction)
    : t('householdSettings.jurisdictionNoneOption');

  const saveDisabled = !isValid || !isDirty || updateHousehold.isPending;

  const handleCta = () => {
    if (saveDisabled) return;
    // Timezone changes get a confirmation step (below) instead of saving
    // immediately — every other field saves straight away. Country reuses
    // that same gate: the server drops holiday toggles whose key does not
    // exist in the new country's pack and seeds the new one, so the family's
    // holiday list is replaced — that must be consented to, not sprung.
    if (isTimezoneChanged || isCountryChanged) {
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
      onBack={() => router.back()}
      backLabel={tCommon('back')}
    >
      {household && activeNannies.length > 0 ? (
        <View testID="pay-setup-prompt-cards">
          {activeNannies.map(nanny => (
            <PaySetupPromptCard
              key={nanny.id}
              householdId={household.id}
              carerId={nanny.user_id}
              // Override -> profile name -> role label. Without the middle
              // link two un-renamed nannies rendered identical cards.
              carerName={resolveCarerName(nanny, tSettings('role.nanny'))}
            />
          ))}
        </View>
      ) : null}

      <View className="gap-2">
        <FieldLabel>{t('householdSettings.nameLabel')}</FieldLabel>
        <Input
          testID="household-name-input"
          accessibilityLabel={t('householdSettings.nameLabel')}
          value={name}
          onChangeText={setName}
          placeholder={t('householdSettings.namePlaceholder')}
        />
      </View>

      <View className="gap-2">
        <FieldLabel>{t('householdSettings.addressLabel')}</FieldLabel>
        <Input
          testID="household-address-input"
          accessibilityLabel={t('householdSettings.addressLabel')}
          value={addressLine}
          onChangeText={setAddressLine}
          placeholder={t('householdSettings.addressPlaceholder')}
        />
      </View>

      <View className="gap-2">
        <FieldLabel>{t('householdSettings.timezoneLabel')}</FieldLabel>
        <AnimatedPressable
          testID="household-timezone-trigger"
          onPress={() => setIsTimezoneSheetOpen(true)}
        >
          <View className="flex-row items-center justify-between rounded-row border border-input bg-background px-4 py-3">
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
        <FieldLabel>{t('householdSettings.currencyLabel')}</FieldLabel>
        <CurrencySelect
          value={currency}
          onChange={setCurrency}
          testIDPrefix="household"
        />
      </View>

      <View className="gap-2">
        <FieldLabel>{t('householdSettings.country')}</FieldLabel>
        <AnimatedPressable
          testID="household-country-trigger"
          onPress={() => setIsCountrySheetOpen(true)}
        >
          <View className="flex-row items-center justify-between rounded-row border border-input bg-background px-4 py-3">
            <Body>{selectedCountryLabel}</Body>
            <Small className="text-primary">
              {t('householdSettings.jurisdictionChangeButton')}
            </Small>
          </View>
        </AnimatedPressable>
        <Small className="text-muted-foreground">
          {t('householdSettings.countryHint')}
        </Small>
      </View>

      {country === HOLIDAY_COUNTRIES.US ? (
        <View className="gap-2">
          <FieldLabel>{t('householdSettings.jurisdictionLabel')}</FieldLabel>
          <AnimatedPressable
            testID="household-jurisdiction-trigger"
            onPress={() => setIsJurisdictionSheetOpen(true)}
          >
            <View className="flex-row items-center justify-between rounded-row border border-input bg-background px-4 py-3">
              <Body>{selectedJurisdictionLabel}</Body>
              <Small className="text-primary">
                {t('householdSettings.jurisdictionChangeButton')}
              </Small>
            </View>
          </AnimatedPressable>
        </View>
      ) : null}

      <View className="gap-2" testID="household-week-start-section">
        <FieldLabel>{t('householdSettings.weekStartLabel')}</FieldLabel>
        {weekStartLocked ? (
          <>
            <Body>{t(`schedule:weekday.${weekStartsOn}`)}</Body>
            <Small
              testID="household-week-start-locked-hint"
              className="text-muted-foreground"
            >
              {t('householdSettings.weekStartLockedHint')}
            </Small>
          </>
        ) : (
          <>
            <View className="flex-row flex-wrap gap-2">
              {WEEK_START_OPTIONS.map(day => (
                <AnimatedPressable
                  key={day}
                  testID={`household-week-start-${day}`}
                  onPress={() => setWeekStartsOn(day)}
                >
                  <Small
                    className={cn(
                      'rounded-chip bg-secondary px-3 py-2',
                      day === weekStartsOn
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : 'text-foreground'
                    )}
                  >
                    {t(`schedule:weekday.${day}`)}
                  </Small>
                </AnimatedPressable>
              ))}
            </View>
            <Small className="text-muted-foreground">
              {t('householdSettings.weekStartHint')}
            </Small>
          </>
        )}
      </View>

      <View className="gap-2">
        <FieldLabel>{t('householdSettings.approvalModeLabel')}</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {APPROVAL_MODE_OPTIONS.map(mode => (
            <AnimatedPressable
              key={mode}
              testID={`household-approval-mode-${mode}`}
              onPress={() => setApprovalMode(mode)}
            >
              <Small
                className={cn(
                  'rounded-chip bg-secondary px-4 py-2',
                  mode === approvalMode
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : 'text-foreground'
                )}
              >
                {t(`householdSettings.approvalMode.${mode}`)}
              </Small>
            </AnimatedPressable>
          ))}
        </View>
      </View>

      <View className="gap-2">
        <FieldLabel>{t('householdSettings.approvalScopeLabel')}</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {APPROVAL_SCOPE_OPTIONS.map(scope => (
            <AnimatedPressable
              key={scope}
              testID={`household-approval-scope-${scope}`}
              onPress={() => setApprovalScope(scope)}
            >
              <Small
                className={cn(
                  'rounded-chip bg-secondary px-4 py-2',
                  scope === approvalScope
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : 'text-foreground'
                )}
              >
                {t(`householdSettings.approvalScope.${scope}`)}
              </Small>
            </AnimatedPressable>
          ))}
        </View>
      </View>

      <View className="gap-2">
        <FieldLabel>{t('householdSettings.shortNoticeHoursLabel')}</FieldLabel>
        <Input
          testID="household-short-notice-hours-input"
          accessibilityLabel={t('householdSettings.shortNoticeHoursLabel')}
          value={shortNoticeHours}
          onChangeText={setShortNoticeHours}
          keyboardType="number-pad"
        />
      </View>

      <View className="gap-2">
        <FieldLabel>
          {t('householdSettings.cancellationPaidWithinHoursLabel')}
        </FieldLabel>
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

      <View className="gap-2" testID="household-members-section">
        <FieldLabel>{t('householdSettings.membersSectionTitle')}</FieldLabel>
        <ListGroup>
          {activeMembers.map(member => {
            // Only a carer has a profile screen to open (pay, availability,
            // time off) — a co-parent's row stays inert here.
            const isCarer =
              member.role === HOUSEHOLD_ROLES.NANNY ||
              member.role === HOUSEHOLD_ROLES.HELPER;
            const nameBlock = (
              <View className="flex-1 gap-0.5">
                <Body>
                  {resolveCarerName(member, t(`settings:role.${member.role}`))}
                </Body>
                <Small className="text-muted-foreground">
                  {t(`settings:role.${member.role}`)}
                </Small>
              </View>
            );
            return (
              <View
                key={member.id}
                testID={`household-member-row-${member.id}`}
                className="flex-row items-center justify-between px-4 py-3"
              >
                {isCarer ? (
                  <AnimatedPressable
                    testID={`household-member-open-${member.id}`}
                    className="flex-1"
                    onPress={() =>
                      router.push(`/settings/carer/${member.user_id}` as Href)
                    }
                  >
                    {nameBlock}
                  </AnimatedPressable>
                ) : (
                  nameBlock
                )}
                {canRemoveMember(member) ? (
                  <AnimatedPressable
                    testID={`household-member-remove-${member.id}`}
                    accessibilityLabel={t(
                      'householdSettings.removeMemberLabel',
                      {
                        name: resolveCarerName(
                          member,
                          t(`settings:role.${member.role}`)
                        ),
                      }
                    )}
                    onPress={() => setMemberToRemove(member)}
                  >
                    <Small className="text-error-inline-text">
                      {t('householdSettings.removeMemberButton')}
                    </Small>
                  </AnimatedPressable>
                ) : null}
              </View>
            );
          })}
        </ListGroup>
      </View>

      {canLeave ? (
        <View className="gap-2" testID="household-leave-section">
          <FieldLabel>{t('householdSettings.leaveSectionTitle')}</FieldLabel>
          {/* The app's one treatment for a destructive action that must stay
              visible: a real Button, so it gets a press state, an
              `accessibilityRole` and a guaranteed 44pt target — none of which
              the hand-rolled bordered pill this replaces had. `reason` is
              always null here: a parent is never clocked in, and the owner
              (the only other refusal) never sees this block at all.

              No `accessibilityLabel`: the child Text supplies it, and a
              literal one would have rendered `{{name}}` uninterpolated. */}
          <RestrictedActionButton
            testID="household-leave-button"
            variant="outline"
            size="lg"
            destructive
            label={t('householdSettings.leaveButton', {
              name: household.name,
            })}
            reason={null}
            disabled={leaveHousehold.isPending}
            onPress={() => setIsLeaveConfirmOpen(true)}
          />
          <Small className="text-muted-foreground">
            {t('householdSettings.leaveHint')}
          </Small>
        </View>
      ) : null}

      {/* Controlled, no Trigger — same shape as the two confirms below. No
          text input, so AlertDialog's lack of keyboard avoidance never comes
          into play. */}
      <AlertDialog
        open={isLeaveConfirmOpen}
        onOpenChange={setIsLeaveConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('householdSettings.leaveConfirmTitle', {
                name: household.name,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('householdSettings.leaveConfirmBody', {
                name: household.name,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* What actually changes, in the order it will be felt: the
              schedule stops, the record stays, the way back is not theirs. */}
          <View className="gap-1" testID="household-leave-consequences">
            <Body className="text-muted-strong">
              {`• ${t('householdSettings.leaveConsequenceSchedule', {
                name: household.name,
              })}`}
            </Body>
            <Body className="text-muted-strong">
              {`• ${t('householdSettings.leaveConsequenceRecord', {
                name: household.name,
              })}`}
            </Body>
            <Body className="text-muted-strong">
              {`• ${t('householdSettings.leaveConsequenceReturn', {
                name: household.name,
              })}`}
            </Body>
          </View>
          <Small className="text-muted-strong">
            {t('householdSettings.leaveConfirmMoney', { name: household.name })}
          </Small>
          <AlertDialogFooter>
            <AlertDialogCancel testID="household-leave-cancel">
              <Text>{t('householdSettings.leaveConfirmCancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              testID="household-leave-confirm"
              className={buttonVariants({ variant: 'destructive' })}
              onPress={() => void handleConfirmLeave()}
            >
              <Text className="text-destructive-foreground">
                {t('householdSettings.leaveConfirmConfirm')}
              </Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Controlled, no Trigger — opened programmatically from a per-row
          Remove tap above. No text input here (unlike delete-account), so
          AlertDialog's lack of keyboard-avoidance never comes into play. */}
      <AlertDialog
        open={memberToRemove !== null}
        onOpenChange={open => {
          if (!open) setMemberToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('householdSettings.removeMemberConfirmTitle', {
                name: memberToRemove
                  ? resolveCarerName(
                      memberToRemove,
                      t(`settings:role.${memberToRemove.role}`)
                    )
                  : '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('householdSettings.removeMemberConfirmBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel testID="household-member-remove-cancel">
              <Text>{t('householdSettings.removeMemberConfirmCancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              testID="household-member-remove-confirm"
              className={buttonVariants({ variant: 'destructive' })}
              onPress={handleConfirmRemove}
            >
              <Text className="text-destructive-foreground">
                {t('householdSettings.removeMemberConfirmConfirm')}
              </Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Controlled, no Trigger — opened programmatically from the shell's
          pinned CTA (`handleCta`) only when the diff includes a timezone
          or country change, so every other field still saves on a single
          tap. Country copy takes precedence when both are in the diff:
          replacing the holiday list is the consent that must not be sprung. */}
      <AlertDialog
        open={isTimezoneConfirmOpen}
        onOpenChange={setIsTimezoneConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isCountryChanged
                ? t('householdSettings.country')
                : t('householdSettings.timezoneConfirmTitle', {
                    zone: selectedTimezoneLabel,
                  })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isCountryChanged
                ? t('householdSettings.countryHint')
                : t('householdSettings.timezoneConfirmBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              testID={isCountryChanged ? 'household-country-cancel' : undefined}
            >
              <Text>{t('householdSettings.timezoneConfirmCancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              testID={
                isCountryChanged
                  ? 'household-country-confirm'
                  : 'household-timezone-confirm'
              }
              onPress={() => {
                setIsTimezoneConfirmOpen(false);
                void submitDiff();
              }}
            >
              <Text>
                {isCountryChanged
                  ? t('householdSettings.saveButton')
                  : t('householdSettings.timezoneConfirmConfirm')}
              </Text>
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

      <CountryPickerSheet
        visible={isCountrySheetOpen}
        onDismiss={() => setIsCountrySheetOpen(false)}
        selectedValue={country}
        onSelect={value => {
          setCountry(value);
          setIsCountrySheetOpen(false);
        }}
      />

      {country === HOLIDAY_COUNTRIES.US ? (
        <JurisdictionPickerSheet
          visible={isJurisdictionSheetOpen}
          onDismiss={() => setIsJurisdictionSheetOpen(false)}
          selectedValue={jurisdiction}
          onSelect={value => {
            setJurisdiction(value);
            setIsJurisdictionSheetOpen(false);
          }}
        />
      ) : null}
    </SetupScreenShell>
  );
}
