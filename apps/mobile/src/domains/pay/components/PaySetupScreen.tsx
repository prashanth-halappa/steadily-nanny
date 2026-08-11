/**
 * @module domains/pay/components/PaySetupScreen
 *
 * "Set up pay for {name}" — TIER0-PLAN.md owner decision 8 / TIER0-CX-SPEC.md
 * §2 "First-time setup". A full screen (not a sheet) — the required core plus
 * a keyboard is past `fitContent` territory — reached from the prompt card on
 * Manage household and every no-arrangement empty state in this domain.
 *
 * Required core at the top, always open; every optional term behind a
 * `TermGroup` via the shared `PayTermsGroups` (D-3). There is no seed
 * arrangement here, so §4.2's "a group opens when it has a value" resolves to
 * "everything closed" — the same rule the change sheet uses, reading as a
 * short required form rather than as a document.
 *
 * Two differences from `PayChangeSheet`, both load-bearing:
 *  - the effective date defaults to the day she JOINED the household (when
 *    that is in the past, so already-worked weeks price), not today;
 *  - the cancellation chips start UNSELECTED even though the hours field is
 *    pre-filled from the household's current window — "this is the one term
 *    where silence breeds the dispute" (spec). Save stays disabled until one
 *    is tapped.
 */
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { BackButton } from '@/src/components/ui/back-button';
import { Button } from '@/src/components/ui/button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Input } from '@/src/components/ui/input';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, Label, Small } from '@/src/components/ui/typography';
import { CurrencySelect } from '@/src/domains/pay/components/CurrencySelect';
import { EffectiveDateField } from '@/src/domains/pay/components/EffectiveDateField';
import { PayScheduleFields } from '@/src/domains/pay/components/PayScheduleFields';
import { PayTermsGroups } from '@/src/domains/pay/components/PayTermsGroups';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { isParentEditorRole } from '@/src/domains/setup/types';
import { useCreatePayArrangement } from '@/src/hooks/mutations/useCreatePayArrangement';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { getDeviceCurrency } from '@/src/lib/deviceLocale';
import { localDateInZone } from '@/src/lib/localDate';
import {
  currencySymbol,
  minorToMajorText,
  parseMajorToMinor,
} from '@/src/lib/money';
import { showSuccessToast } from '@/src/lib/toast';
import {
  buildCreatePayArrangementRequest,
  type PayTermsFormState,
} from '../utils/payArrangementForm';

function normalizeParam(
  value: string | string[] | undefined
): string | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** A first-ever arrangement starts blank on every optional term: there is
 * nothing agreed yet to seed from, and a pre-filled 8/12/1.5 would read as a
 * term the family had already chosen. */
function blankFormState(currency: string, todayISO: string): PayTermsFormState {
  return {
    rateText: '',
    currency,
    effectiveDateISO: todayISO,
    todayISO,
    overtimeThresholdHoursText: '',
    overtimeMultiplierText: '1.5',
    dailyOvertimeThresholdHoursText: '',
    doubletimeThresholdHoursText: '',
    doubletimeMultiplierText: '',
    seventhDayMultiplierText: '',
    seventhDayDoubletimeAfterHoursText: '',
    workedHolidayMultiplierText: '',
    holidayHoursText: '',
    guaranteedHoursText: '',
    ptoHoursPerYearText: '',
    mileageRateText: '',
    cancellationChoice: null,
    cancellationHoursText: '',
    note: '',
    noticePeriodWeeksText: '',
    probationDaysText: '',
    dutiesText: '',
    drivingText: '',
    stipends: [],
    // 082's pay schedule — blank on a first-ever arrangement, same as every
    // other optional term above: nothing is agreed yet to seed from.
    payFrequency: '',
    payDayOfWeekText: '',
    payDayOfMonthText: '',
    // Deliberately absent: `currentOvertimeMultiplier`. The redirect below
    // means there is no current arrangement by the time this renders, so 1.5
    // (the blank-threshold default in `buildCreatePayArrangementRequest`) is
    // always right here. Editing an existing arrangement is PayChangeSheet's.
  };
}

export function PaySetupScreen() {
  const { t } = useTranslation('pay');
  const { t: tCommon } = useTranslation('common');
  const { t: tSettings } = useTranslation('settings');
  const router = useRouter();
  const params = useLocalSearchParams<{ carerId?: string | string[] }>();
  const carerId = normalizeParam(params.carerId);

  const onboarding = useIsOnboarded();
  const activeHousehold = useActiveHousehold();
  const householdId = activeHousehold.householdId;
  const household = activeHousehold.household;
  const members = useHouseholdMembers(householdId);
  // Whether a current arrangement already exists for this carer — if it
  // does, this screen was reached a second time (e.g. the prompt-card link
  // stayed reachable after someone else already set her terms), and seeding
  // the day she joined would silently backdate a change she may not intend.
  // Default to today instead in that case (review finding 9).
  const currentArrangement = useCurrentPayArrangement(
    householdId,
    carerId ?? null
  );
  const createArrangement = useCreatePayArrangement(
    householdId ?? '',
    carerId ?? ''
  );

  const member = (members.data ?? []).find(m => m.user_id === carerId);
  const carerName = resolveCarerName(member, tSettings('role.nanny'));
  const timezone = household?.timezone ?? 'UTC';
  const todayISO = localDateInZone(timezone);
  const householdCancellationDefaultHours =
    household?.cancellation_paid_within_hours ?? 0;

  // Device Language & Region as a PREFILL only — the select below always lets
  // it be overridden, because currency belongs to the employment arrangement
  // and not to whichever phone happens to be creating it.
  const [form, setForm] = useState<PayTermsFormState>(() =>
    blankFormState(getDeviceCurrency(), todayISO)
  );
  const patch = (next: Partial<PayTermsFormState>) =>
    setForm(current => ({ ...current, ...next }));

  // Seed the effective-date default and the cancellation-hours prefill ONCE,
  // the first time both the member and household have loaded — mirrors
  // ManageHouseholdScreen's hasSeededRef pattern, so a background refetch
  // never clobbers what the parent is mid-typing.
  const hasSeededRef = useRef(false);
  useEffect(() => {
    if (
      hasSeededRef.current ||
      !member ||
      !household ||
      currentArrangement.isPending
    ) {
      return;
    }
    hasSeededRef.current = true;
    // Only seed the joined-date default when there is genuinely no current
    // arrangement yet — the first-time-setup case the screen is named for.
    // A current arrangement already existing means "today" is the honest
    // default (review finding 9).
    const joinedDateISO = localDateInZone(timezone, new Date(member.joined_at));
    setForm(current => ({
      ...current,
      // Household currency over the device prefill, once the household has
      // loaded — currency belongs to the household's employment arrangements,
      // not to whichever phone happened to create this one.
      currency: household.currency ?? getDeviceCurrency(),
      effectiveDateISO:
        !currentArrangement.data && joinedDateISO < todayISO
          ? joinedDateISO
          : current.effectiveDateISO,
      todayISO,
      cancellationHoursText:
        householdCancellationDefaultHours > 0
          ? String(householdCancellationDefaultHours)
          : '',
    }));
  }, [
    member,
    household,
    timezone,
    todayISO,
    householdCancellationDefaultHours,
    currentArrangement.isPending,
    currentArrangement.data,
  ]);

  // Setup is first-time only. An existing arrangement means we were reached
  // via a stale stack or deep link — bounce to the pay hub before a blank
  // form can append a destructive half-null row. PayChangeSheet owns edits.
  // A `useEffect`, not a call during render: every other redirect in this
  // codebase (`app/index.tsx`, `(private)/_layout.tsx`) fires from an
  // effect, never synchronously while rendering.
  useEffect(() => {
    if (currentArrangement.data) {
      router.replace('/settings/pay' as Href);
    }
  }, [currentArrangement.data, router]);

  if (onboarding.status === 'loading' || activeHousehold.isLoading) {
    return (
      <View testID="pay-setup-screen" className="flex-1 bg-background">
        <LoadingIndicator testID="pay-loading" />
      </View>
    );
  }

  if (!isParentEditorRole(onboarding.role) || onboarding.isPastMember) {
    return (
      <View testID="pay-setup-not-available" className="flex-1 bg-background">
        <View
          style={{
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
          }}
        >
          <BackButton
            testID="pay-setup-not-available-back"
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
            title={t('notAvailableTitle')}
            description={t('notAvailableDescription')}
          />
        </View>
      </View>
    );
  }

  if (
    !householdId ||
    !carerId ||
    members.isPending ||
    currentArrangement.isPending
  ) {
    return (
      <View testID="pay-setup-screen" className="flex-1 bg-background">
        <LoadingIndicator testID="pay-loading" />
      </View>
    );
  }

  // Setup is first-time only. An existing arrangement means we were reached
  // via a stale stack or deep link — bounce to the pay hub before a blank
  // form can append a destructive half-null row. PayChangeSheet owns edits.
  // The render-time check below only decides WHAT to render (never call a
  // router method during render — every other redirect in this codebase,
  // e.g. `app/index.tsx` and `(private)/_layout.tsx`, fires from a
  // `useEffect`); the actual `router.replace` call lives in the effect above.
  if (currentArrangement.data) {
    return (
      <View testID="pay-setup-screen" className="flex-1 bg-background">
        <LoadingIndicator testID="pay-loading" />
      </View>
    );
  }

  const request = buildCreatePayArrangementRequest({ ...form, todayISO });

  const handleSubmit = async () => {
    if (!request) return;
    try {
      await createArrangement.mutateAsync(request);
      showSuccessToast(t('setup.savedToast'));
      router.back();
    } catch {
      // useCreatePayArrangement's onError already surfaced a toast; keep the
      // form as typed (same discipline as PayChangeSheet).
    }
  };

  return (
    <SetupScreenShell
      testID="pay-setup-screen"
      title={t('setup.title', { name: carerName })}
      subtitle={t('setup.subtitle', { name: carerName })}
      ctaLabel={t('setup.submitButton')}
      onCta={() => void handleSubmit()}
      ctaDisabled={!request || createArrangement.isPending}
      onBack={() => router.back()}
      backLabel={tCommon('back')}
    >
      <View className="gap-2">
        <Label>{t('changeSheet.currencyLabel')}</Label>
        <CurrencySelect
          value={form.currency}
          onChange={currency => patch({ currency })}
          testIDPrefix="pay-setup"
        />
      </View>

      <View className="gap-2">
        <Label>{t('changeSheet.rateLabel')}</Label>
        <View className="flex-row items-center gap-2">
          <Body
            testID="pay-setup-currency-prefix"
            className="text-muted-foreground"
          >
            {currencySymbol(form.currency)}
          </Body>
          <Input
            testID="pay-setup-rate-input"
            accessibilityLabel={t('changeSheet.rateLabel')}
            value={form.rateText}
            onChangeText={rateText => patch({ rateText })}
            onBlur={() => {
              const minor = parseMajorToMinor(form.rateText);
              if (minor !== null) patch({ rateText: minorToMajorText(minor) });
            }}
            keyboardType="decimal-pad"
            className="flex-1"
          />
        </View>
      </View>

      {/* T10: the SAME date field the change sheet renders, so setup can no
          longer accept a date the change flow would refuse. */}
      <EffectiveDateField
        testIDPrefix="pay-setup"
        value={form.effectiveDateISO}
        onChange={effectiveDateISO => patch({ effectiveDateISO })}
        todayISO={todayISO}
      />

      <View className="gap-2">
        <Label>{t('changeSheet.cancellationsFieldLabel')}</Label>
        <View className="flex-row flex-wrap gap-2">
          <Button
            testID="pay-setup-cancellation-chip-window"
            variant={
              form.cancellationChoice === 'window' ? 'default' : 'outline'
            }
            size="sm"
            onPress={() => patch({ cancellationChoice: 'window' })}
          >
            <Text>{t('changeSheet.cancellationWindowChip')}</Text>
          </Button>
          <Button
            testID="pay-setup-cancellation-chip-none"
            variant={form.cancellationChoice === 'none' ? 'default' : 'outline'}
            size="sm"
            onPress={() => patch({ cancellationChoice: 'none' })}
          >
            <Text>{t('changeSheet.cancellationNoneChip')}</Text>
          </Button>
        </View>
        {form.cancellationChoice === 'window' ? (
          <Input
            testID="pay-setup-cancellation-hours-input"
            accessibilityLabel={t('changeSheet.cancellationHoursLabel')}
            value={form.cancellationHoursText}
            onChangeText={cancellationHoursText =>
              patch({ cancellationHoursText })
            }
            keyboardType="number-pad"
          />
        ) : null}
        {form.cancellationChoice === null ? (
          <Small
            testID="pay-setup-cancellation-required-hint"
            className="text-muted-foreground"
          >
            {t('setup.cancellationRequiredHint')}
          </Small>
        ) : null}
      </View>

      {/* No `seed` — there is no arrangement yet, so every group is closed
          and D-6's weekly-equivalent line has nothing stored to render. */}
      <PayTermsGroups
        testIDPrefix="pay-setup"
        state={form}
        onChange={patch}
        seed={null}
      />

      {/* 082's pay schedule (D-17, T7 reversal) — presentation only, not part
          of PayTermsGroups' D-3 expanders (spec §4.3 lists it as its own,
          always-visible block, same as the required core). */}
      <PayScheduleFields
        testIDPrefix="pay-setup"
        t={t}
        payFrequency={form.payFrequency}
        onPayFrequencyChange={payFrequency => patch({ payFrequency })}
        payDayOfWeekText={form.payDayOfWeekText}
        onPayDayOfWeekTextChange={payDayOfWeekText =>
          patch({ payDayOfWeekText })
        }
        payDayOfMonthText={form.payDayOfMonthText}
        onPayDayOfMonthTextChange={payDayOfMonthText =>
          patch({ payDayOfMonthText })
        }
      />

      <View className="gap-2">
        <Label>{t('changeSheet.noteLabel')}</Label>
        <Textarea
          testID="pay-setup-note-input"
          accessibilityLabel={t('changeSheet.noteLabel')}
          value={form.note}
          onChangeText={note => patch({ note })}
          placeholder={t('changeSheet.notePlaceholder')}
        />
      </View>
    </SetupScreenShell>
  );
}
