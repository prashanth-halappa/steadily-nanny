/**
 * @module domains/pay/components/PayChangeSheet
 *
 * "Change terms" — TIER0-CX-SPEC.md §2's change flow, amended per
 * TIER0-PLAN.md owner decision 4: no future-dated changes in v1, so the
 * effective-date control defaults to TODAY (never "next Monday") and there
 * is no "Scheduled change" card. Past dates are allowed and backdate; a
 * future date is not selectable at all.
 *
 * Sheet-owns-values, screen-owns-mutation (the `ClockOutSheet` discipline,
 * `NannyWeekView.tsx`'s `handleSaveCorrection`): this component only builds
 * and reports a `CreatePayArrangementRequest` via `onSubmit`; the caller
 * decides whether to close the sheet, and only does so on success — a
 * refusal (a bad value, a network error) leaves every typed field intact so
 * the parent doesn't have to retype the whole form.
 *
 * SIMPLIFICATION (documented per the task brief, not silent): the spec's
 * backdating hint is meant to appear "only when a past date is chosen and
 * the affected week is already approved". This component has no hook that
 * tells it whether that week is approved, so it renders the hint whenever a
 * past date is chosen — a slightly wider net than the spec's ideal, but
 * never wrong to show (an unapproved week just recomputes silently, so the
 * hint is simply inapplicable there rather than misleading).
 */

import type {
  CreatePayArrangementRequest,
  PayArrangement,
} from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { cn } from '@/lib/utils';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H4, Label, Small } from '@/src/components/ui/typography';
import { localDateInZone } from '@/src/lib/localDate';
import { minorToMajorText, parseMajorToMinor } from '@/src/lib/money';
import { currencySymbol } from '../utils/currencySymbol';
import {
  buildCreatePayArrangementRequest,
  buildMidWeekConsequence,
  formatShortDate,
  isValidCalendarDate,
  type PayTermsFormState,
} from '../utils/payArrangementForm';

interface PayChangeSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (input: CreatePayArrangementRequest) => void;
  isSubmitting: boolean;
  /** The sheet only ever adjusts an existing arrangement — the "first
   * arrangement ever" case is `PaySetupScreen`, a full screen, not this
   * sheet. Fields seed from this. */
  currentArrangement: PayArrangement;
  /** For the cancellation-hours default when the current arrangement has no
   * per-nanny window set — the household's fallback column. */
  householdCancellationDefaultHours: number;
  /** Household-local today, "yyyy-mm-dd" — injectable for tests. Used for
   * the chip label and the render-time enable/disable check; the ACTUAL
   * submitted date is recomputed fresh at submit time from
   * `householdTimezone` (review finding 11 — see `handleSubmit`). */
  todayISO: string;
  /** IANA timezone — recomputes "today" at submit time so a sheet left open
   * across midnight never submits a stale date (review finding 11). */
  householdTimezone: string;
}

function EffectiveDateChip({
  testID,
  selected,
  label,
  onPress,
}: {
  testID: string;
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Button
      testID={testID}
      variant={selected ? 'default' : 'outline'}
      size="sm"
      onPress={onPress}
    >
      <Text className={cn(selected ? undefined : 'text-foreground')}>
        {label}
      </Text>
    </Button>
  );
}

export function PayChangeSheet({
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
  currentArrangement,
  householdCancellationDefaultHours,
  todayISO,
  householdTimezone,
}: PayChangeSheetProps) {
  const { t } = useTranslation('pay');

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

  // Re-seed every time the sheet opens, from the CURRENT arrangement — a
  // "change" usually adjusts one term, so starting from what's already
  // agreed is friendlier than a blank form. Mirrors ClockOutSheet's
  // re-seed-on-`visible` pattern (it stays mounted between openings).
  useEffect(() => {
    if (!visible) return;
    setRateText(minorToMajorText(currentArrangement.rate_minor));
    setEffectiveChoice('today');
    setEarlierDateText('');
    setOvertimeThresholdHoursText(
      currentArrangement.overtime_threshold_minutes === null
        ? ''
        : String(currentArrangement.overtime_threshold_minutes / 60)
    );
    setOvertimeMultiplierText(String(currentArrangement.overtime_multiplier));
    setGuaranteedHoursText(
      currentArrangement.guaranteed_minutes_per_week === null
        ? ''
        : String(currentArrangement.guaranteed_minutes_per_week / 60)
    );
    setPtoHoursPerYearText(
      currentArrangement.pto_entitlement_minutes_per_year === null
        ? ''
        : String(currentArrangement.pto_entitlement_minutes_per_year / 60)
    );
    setMileageRateText(
      currentArrangement.mileage_rate_per_mile_minor === null
        ? ''
        : minorToMajorText(currentArrangement.mileage_rate_per_mile_minor)
    );
    setCancellationChoice(
      currentArrangement.cancellation_paid_within_hours === null
        ? 'none'
        : 'window'
    );
    setCancellationHoursText(
      currentArrangement.cancellation_paid_within_hours !== null
        ? String(currentArrangement.cancellation_paid_within_hours)
        : householdCancellationDefaultHours > 0
          ? String(householdCancellationDefaultHours)
          : ''
    );
    setNote('');
  }, [visible, currentArrangement, householdCancellationDefaultHours]);

  const effectiveDateISO =
    effectiveChoice === 'today' ? todayISO : earlierDateText;
  const earlierDateInvalid =
    effectiveChoice === 'earlier' &&
    earlierDateText.length > 0 &&
    (!isValidCalendarDate(earlierDateText) || earlierDateText > todayISO);
  const showBackdatingHint =
    effectiveChoice === 'earlier' &&
    isValidCalendarDate(earlierDateText) &&
    earlierDateText < todayISO;

  const typedRateMinor = parseMajorToMinor(rateText);
  const midWeek =
    typedRateMinor !== null
      ? buildMidWeekConsequence(
          effectiveDateISO,
          currentArrangement.rate_minor,
          currentArrangement.currency,
          typedRateMinor,
          currentArrangement.currency
        )
      : null;

  const formState: PayTermsFormState = {
    rateText,
    currency: currentArrangement.currency,
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
    currentOvertimeMultiplier: currentArrangement.overtime_multiplier,
  };
  // Render-time only — drives the chip variants and the submit button's
  // enabled state. The chip label is allowed to stay render-time (review
  // finding 11's own carve-out); this value must NOT be what gets submitted.
  const request = buildCreatePayArrangementRequest(formState);

  const handleSubmit = () => {
    // Recomputed HERE, not read from the `todayISO` prop closed over at
    // render time: a sheet left open across midnight must submit today's
    // real date, not whatever "today" was when it was opened (review
    // finding 11).
    const submitTodayISO = localDateInZone(householdTimezone);
    const submitState: PayTermsFormState = {
      ...formState,
      effectiveDateISO:
        effectiveChoice === 'today' ? submitTodayISO : earlierDateText,
      todayISO: submitTodayISO,
    };
    const submitRequest = buildCreatePayArrangementRequest(submitState);
    if (!submitRequest) return;
    onSubmit(submitRequest);
  };

  return (
    <BottomSheetBase
      sheetId="pay-change"
      visible={visible}
      onDismiss={onDismiss}
      testID="pay-change-sheet"
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{t('changeSheet.title')}</H4>

        <View className="gap-2">
          <Label>{t('changeSheet.rateLabel')}</Label>
          <View className="flex-row items-center gap-2">
            <Body
              testID="pay-change-currency-prefix"
              className="text-muted-foreground"
            >
              {currencySymbol(currentArrangement.currency)}
            </Body>
            <Input
              testID="pay-change-rate-input"
              accessibilityLabel={t('changeSheet.rateLabel')}
              value={rateText}
              onChangeText={setRateText}
              onBlur={() => {
                const minor = parseMajorToMinor(rateText);
                if (minor !== null) setRateText(minorToMajorText(minor));
              }}
              keyboardType="decimal-pad"
              className="flex-1"
            />
          </View>
        </View>

        <View className="gap-2">
          <Label>{t('changeSheet.effectiveLabel')}</Label>
          <View className="flex-row flex-wrap gap-2">
            <EffectiveDateChip
              testID="pay-change-chip-today"
              selected={effectiveChoice === 'today'}
              label={t('changeSheet.chipToday', {
                date: formatShortDate(todayISO),
              })}
              onPress={() => setEffectiveChoice('today')}
            />
            <EffectiveDateChip
              testID="pay-change-chip-earlier"
              selected={effectiveChoice === 'earlier'}
              label={t('changeSheet.chipEarlier')}
              onPress={() => setEffectiveChoice('earlier')}
            />
          </View>
          {effectiveChoice === 'earlier' ? (
            <Input
              testID="pay-change-date-input"
              accessibilityLabel={t('changeSheet.dateInputLabel')}
              value={earlierDateText}
              onChangeText={setEarlierDateText}
              placeholder={t('changeSheet.datePlaceholder')}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              error={earlierDateInvalid}
            />
          ) : null}
          {earlierDateInvalid ? (
            <Small testID="pay-change-date-error" className="text-destructive">
              {t('changeSheet.dateInvalid')}
            </Small>
          ) : null}
          {showBackdatingHint ? (
            <Small
              testID="pay-change-backdating-hint"
              className="text-muted-foreground"
            >
              {t('changeSheet.backdatingHint')}
            </Small>
          ) : null}
          {midWeek ? (
            <Small
              testID="pay-change-midweek-consequence"
              className="text-warning-strong"
            >
              {t('changeSheet.midWeekConsequence', {
                oldRate: midWeek.oldRateLabel,
                oldUntil: midWeek.oldUntilLabel,
                newRate: midWeek.newRateLabel,
                newFrom: midWeek.newFromLabel,
              })}
            </Small>
          ) : null}
        </View>

        <View className="gap-2">
          <Label>{t('changeSheet.overtimeAfterLabel')}</Label>
          <View className="flex-row gap-2">
            <Input
              testID="pay-change-overtime-threshold-input"
              accessibilityLabel={t('changeSheet.overtimeAfterLabel')}
              value={overtimeThresholdHoursText}
              onChangeText={setOvertimeThresholdHoursText}
              keyboardType="decimal-pad"
              className="flex-1"
            />
            <Input
              testID="pay-change-overtime-multiplier-input"
              accessibilityLabel={t('changeSheet.overtimePaidAtLabel')}
              value={overtimeMultiplierText}
              onChangeText={setOvertimeMultiplierText}
              keyboardType="decimal-pad"
              className="flex-1"
            />
          </View>
          <Small
            testID="pay-change-overtime-hint"
            className="text-muted-foreground"
          >
            {t('changeSheet.overtimeHint')}
          </Small>
        </View>

        <View className="gap-2">
          <Label>{t('changeSheet.guaranteedHoursFieldLabel')}</Label>
          <Input
            testID="pay-change-guaranteed-hours-input"
            accessibilityLabel={t('changeSheet.guaranteedHoursFieldLabel')}
            value={guaranteedHoursText}
            onChangeText={setGuaranteedHoursText}
            keyboardType="decimal-pad"
          />
        </View>

        <View className="gap-2">
          <Label>{t('changeSheet.ptoFieldLabel')}</Label>
          <Input
            testID="pay-change-pto-hours-input"
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
            testID="pay-change-mileage-rate-input"
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
            <EffectiveDateChip
              testID="pay-change-cancellation-chip-window"
              selected={cancellationChoice === 'window'}
              label={t('changeSheet.cancellationWindowChip')}
              onPress={() => setCancellationChoice('window')}
            />
            <EffectiveDateChip
              testID="pay-change-cancellation-chip-none"
              selected={cancellationChoice === 'none'}
              label={t('changeSheet.cancellationNoneChip')}
              onPress={() => setCancellationChoice('none')}
            />
          </View>
          {cancellationChoice === 'window' ? (
            <Input
              testID="pay-change-cancellation-hours-input"
              accessibilityLabel={t('changeSheet.cancellationHoursLabel')}
              value={cancellationHoursText}
              onChangeText={setCancellationHoursText}
              keyboardType="number-pad"
            />
          ) : null}
        </View>

        <View className="gap-2">
          <Label>{t('changeSheet.noteLabel')}</Label>
          <Textarea
            testID="pay-change-note-input"
            accessibilityLabel={t('changeSheet.noteLabel')}
            value={note}
            onChangeText={setNote}
            placeholder={t('changeSheet.notePlaceholder')}
          />
        </View>

        <LoadingButton
          testID="pay-change-submit"
          label={t('changeSheet.submitButton')}
          isLoading={isSubmitting}
          disabled={!request}
          onPress={handleSubmit}
        />
      </View>
    </BottomSheetBase>
  );
}
