/**
 * @module domains/pay/components/PaySetupScreen
 *
 * "Set up pay for {name}" — TIER0-PLAN.md owner decision 8 / TIER0-CX-SPEC.md
 * §2 "First-time setup". A full screen (not a sheet) — seven fields with a
 * keyboard is past `fitContent` territory — reached from the prompt card on
 * Manage household and every no-arrangement empty state in this domain.
 *
 * Two differences from `PayChangeSheet`, both load-bearing:
 *  - the effective date defaults to the day she JOINED the household (when
 *    that is in the past, so already-worked weeks price), not today;
 *  - the cancellation chips start UNSELECTED even though the hours field is
 *    pre-filled from the household's current window — "this is the one term
 *    where silence breeds the dispute" (spec). Save stays disabled until one
 *    is tapped.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Input } from '@/src/components/ui/input';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, Label, Small } from '@/src/components/ui/typography';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { isParentEditorRole } from '@/src/domains/setup/types';
import { useCreatePayArrangement } from '@/src/hooks/mutations/useCreatePayArrangement';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { localDateInZone } from '@/src/lib/localDate';
import { minorToMajorText, parseMajorToMinor } from '@/src/lib/money';
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
  const carerName =
    member?.display_name_override?.trim() || tSettings('role.nanny');
  const timezone = household?.timezone ?? 'UTC';
  const todayISO = localDateInZone(timezone);
  const householdCancellationDefaultHours =
    household?.cancellation_paid_within_hours ?? 0;

  const [rateText, setRateText] = useState('');
  const [effectiveChoice, setEffectiveChoice] = useState<'today' | 'earlier'>(
    'today'
  );
  const [earlierDateText, setEarlierDateText] = useState('');
  const [overtimeThresholdHoursText, setOvertimeThresholdHoursText] =
    useState('');
  const [overtimeMultiplierText, setOvertimeMultiplierText] = useState('1.5');
  const [guaranteedHoursText, setGuaranteedHoursText] = useState('');
  const [ptoHoursPerYearText, setPtoHoursPerYearText] = useState('');
  const [mileageRateText, setMileageRateText] = useState('');
  const [cancellationChoice, setCancellationChoice] = useState<
    'window' | 'none' | null
  >(null);
  const [cancellationHoursText, setCancellationHoursText] = useState('');
  const [note, setNote] = useState('');

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
    // A current arrangement already existing means "today" (the initial
    // state) is the honest default (review finding 9).
    const joinedDateISO = localDateInZone(timezone, new Date(member.joined_at));
    if (!currentArrangement.data && joinedDateISO < todayISO) {
      setEffectiveChoice('earlier');
      setEarlierDateText(joinedDateISO);
    }
    setCancellationHoursText(
      householdCancellationDefaultHours > 0
        ? String(householdCancellationDefaultHours)
        : ''
    );
  }, [
    member,
    household,
    timezone,
    todayISO,
    householdCancellationDefaultHours,
    currentArrangement.isPending,
    currentArrangement.data,
  ]);

  if (onboarding.status === 'loading' || activeHousehold.isLoading) {
    return (
      <View testID="pay-setup-screen" className="flex-1 bg-background">
        <LoadingIndicator testID="pay-loading" />
      </View>
    );
  }

  if (!isParentEditorRole(onboarding.role)) {
    return (
      <View testID="pay-setup-not-available" className="flex-1 bg-background">
        <View className="px-6 pt-8">
          <Pressable
            testID="pay-setup-not-available-back"
            accessibilityRole="button"
            accessibilityLabel={tCommon('back')}
            onPress={() => router.back()}
            hitSlop={8}
            className="self-start"
          >
            <Body className="text-primary">{`< ${tCommon('back')}`}</Body>
          </Pressable>
        </View>
        <View className="mt-8 px-6">
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

  const effectiveDateISO =
    effectiveChoice === 'today' ? todayISO : earlierDateText;
  const formState: PayTermsFormState = {
    rateText,
    currency: 'GBP',
    effectiveDateISO,
    todayISO,
    overtimeThresholdHoursText,
    overtimeMultiplierText,
    guaranteedHoursText,
    ptoHoursPerYearText,
    mileageRateText,
    cancellationChoice,
    cancellationHoursText,
    note,
    // Almost always undefined here (this screen is the FIRST arrangement,
    // where 1.5 is the right blank-threshold default) — but if a current
    // arrangement does exist (review finding 9's re-entry case), carry its
    // multiplier through unchanged too, same discipline as PayChangeSheet
    // (review finding 6).
    currentOvertimeMultiplier: currentArrangement.data?.overtime_multiplier,
  };
  const request = buildCreatePayArrangementRequest(formState);

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
        <Label>{t('changeSheet.rateLabel')}</Label>
        <Input
          testID="pay-setup-rate-input"
          accessibilityLabel={t('changeSheet.rateLabel')}
          value={rateText}
          onChangeText={setRateText}
          onBlur={() => {
            const minor = parseMajorToMinor(rateText);
            if (minor !== null) setRateText(minorToMajorText(minor));
          }}
          keyboardType="decimal-pad"
        />
      </View>

      <View className="gap-2">
        <Label>{t('changeSheet.effectiveLabel')}</Label>
        <View className="flex-row flex-wrap gap-2">
          <Button
            testID="pay-setup-chip-today"
            variant={effectiveChoice === 'today' ? 'default' : 'outline'}
            size="sm"
            onPress={() => setEffectiveChoice('today')}
          >
            <Text>
              {t('changeSheet.chipToday', { date: todayISO.slice(5) })}
            </Text>
          </Button>
          <Button
            testID="pay-setup-chip-earlier"
            variant={effectiveChoice === 'earlier' ? 'default' : 'outline'}
            size="sm"
            onPress={() => setEffectiveChoice('earlier')}
          >
            <Text>{t('changeSheet.chipEarlier')}</Text>
          </Button>
        </View>
        {effectiveChoice === 'earlier' ? (
          <Input
            testID="pay-setup-date-input"
            accessibilityLabel={t('changeSheet.dateInputLabel')}
            value={earlierDateText}
            onChangeText={setEarlierDateText}
            placeholder={t('changeSheet.datePlaceholder')}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
        ) : null}
      </View>

      <View className="gap-2">
        <Label>{t('changeSheet.overtimeAfterLabel')}</Label>
        <View className="flex-row gap-2">
          <Input
            testID="pay-setup-overtime-threshold-input"
            accessibilityLabel={t('changeSheet.overtimeAfterLabel')}
            value={overtimeThresholdHoursText}
            onChangeText={setOvertimeThresholdHoursText}
            keyboardType="decimal-pad"
            className="flex-1"
          />
          <Input
            testID="pay-setup-overtime-multiplier-input"
            accessibilityLabel={t('changeSheet.overtimePaidAtLabel')}
            value={overtimeMultiplierText}
            onChangeText={setOvertimeMultiplierText}
            keyboardType="decimal-pad"
            className="flex-1"
          />
        </View>
        <Small className="text-muted-foreground">
          {t('changeSheet.overtimeHint')}
        </Small>
      </View>

      <View className="gap-2">
        <Label>{t('changeSheet.guaranteedHoursFieldLabel')}</Label>
        <Input
          testID="pay-setup-guaranteed-hours-input"
          accessibilityLabel={t('changeSheet.guaranteedHoursFieldLabel')}
          value={guaranteedHoursText}
          onChangeText={setGuaranteedHoursText}
          keyboardType="decimal-pad"
        />
      </View>

      <View className="gap-2">
        <Label>{t('changeSheet.ptoFieldLabel')}</Label>
        <Input
          testID="pay-setup-pto-hours-input"
          accessibilityLabel={t('changeSheet.ptoFieldLabel')}
          value={ptoHoursPerYearText}
          onChangeText={setPtoHoursPerYearText}
          keyboardType="decimal-pad"
        />
        <Small className="text-muted-foreground">
          {t('changeSheet.ptoHint')}
        </Small>
      </View>

      <View className="gap-2">
        <Label>{t('changeSheet.mileageFieldLabel')}</Label>
        <Input
          testID="pay-setup-mileage-rate-input"
          accessibilityLabel={t('changeSheet.mileageFieldLabel')}
          value={mileageRateText}
          onChangeText={setMileageRateText}
          keyboardType="decimal-pad"
        />
        <Small className="text-muted-foreground">
          {t('changeSheet.mileageHint')}
        </Small>
      </View>

      <View className="gap-2">
        <Label>{t('changeSheet.cancellationsFieldLabel')}</Label>
        <View className="flex-row flex-wrap gap-2">
          <Button
            testID="pay-setup-cancellation-chip-window"
            variant={cancellationChoice === 'window' ? 'default' : 'outline'}
            size="sm"
            onPress={() => setCancellationChoice('window')}
          >
            <Text>{t('changeSheet.cancellationWindowChip')}</Text>
          </Button>
          <Button
            testID="pay-setup-cancellation-chip-none"
            variant={cancellationChoice === 'none' ? 'default' : 'outline'}
            size="sm"
            onPress={() => setCancellationChoice('none')}
          >
            <Text>{t('changeSheet.cancellationNoneChip')}</Text>
          </Button>
        </View>
        {cancellationChoice === 'window' ? (
          <Input
            testID="pay-setup-cancellation-hours-input"
            accessibilityLabel={t('changeSheet.cancellationHoursLabel')}
            value={cancellationHoursText}
            onChangeText={setCancellationHoursText}
            keyboardType="number-pad"
          />
        ) : null}
        {cancellationChoice === null ? (
          <Small
            testID="pay-setup-cancellation-required-hint"
            className="text-muted-foreground"
          >
            {t('setup.cancellationRequiredHint')}
          </Small>
        ) : null}
      </View>

      <View className="gap-2">
        <Label>{t('changeSheet.noteLabel')}</Label>
        <Textarea
          testID="pay-setup-note-input"
          accessibilityLabel={t('changeSheet.noteLabel')}
          value={note}
          onChangeText={setNote}
          placeholder={t('changeSheet.notePlaceholder')}
        />
      </View>
    </SetupScreenShell>
  );
}
