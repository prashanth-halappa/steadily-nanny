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
import {
  currencySymbol,
  minorToMajorText,
  parseMajorToMinor,
} from '@/src/lib/money';
import {
  buildCreatePayArrangementRequest,
  buildMidWeekConsequence,
  formatShortDate,
  isValidCalendarDate,
  type PayTermsFormState,
} from '../utils/payArrangementForm';
import { CurrencySelect } from './CurrencySelect';

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
  /** Household `week_starts_on` (0=Sunday..6=Saturday). Decides which
   * effective dates split a week, and so whether the mid-week consequence
   * line shows — a Monday literal would warn a Sunday-start household on
   * exactly the wrong day. */
  householdWeekStartsOn: number;
}

/** A minutes column as an hours field's text. Absent or null (078: an
 * explicit "no tier") seeds an EMPTY field — never a fabricated 8 or 1.5,
 * which would read as a term the family already agreed. */
function minutesToHoursText(minutes: number | null | undefined): string {
  return minutes == null ? '' : String(minutes / 60);
}

/** Same, for the nullable multiplier columns. */
function multiplierToText(multiplier: number | null | undefined): string {
  return multiplier == null ? '' : String(multiplier);
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
  householdWeekStartsOn,
}: PayChangeSheetProps) {
  const { t } = useTranslation('pay');

  // Seeded from the arrangement, NOT `getDeviceCurrency()`: an existing
  // arrangement's currency is a stored fact about the employment, and the
  // device of whoever opens this sheet says nothing about it. Reset alongside
  // every other field in the `visible` effect below.
  const [currency, setCurrency] = useState(currentArrangement.currency);
  const [rateText, setRateText] = useState('');
  const [effectiveChoice, setEffectiveChoice] = useState<'today' | 'earlier'>(
    'today'
  );
  const [earlierDateText, setEarlierDateText] = useState('');
  const [overtimeThresholdHoursText, setOvertimeThresholdHoursText] =
    useState('');
  const [overtimeMultiplierText, setOvertimeMultiplierText] = useState('1.5');
  const [dailyOvertimeThresholdHoursText, setDailyOvertimeThresholdHoursText] =
    useState('');
  const [doubletimeThresholdHoursText, setDoubletimeThresholdHoursText] =
    useState('');
  const [doubletimeMultiplierText, setDoubletimeMultiplierText] = useState('');
  const [seventhDayMultiplierText, setSeventhDayMultiplierText] = useState('');
  const [
    seventhDayDoubletimeAfterHoursText,
    setSeventhDayDoubletimeAfterHoursText,
  ] = useState('');
  const [workedHolidayMultiplierText, setWorkedHolidayMultiplierText] =
    useState('');
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
      minutesToHoursText(currentArrangement.overtime_threshold_minutes)
    );
    setOvertimeMultiplierText(String(currentArrangement.overtime_multiplier));
    // The 078 tiers, seeded exactly like the weekly pair above: a change that
    // only touches the rate must re-send every other term unchanged, or the
    // new (append-only) row silently drops the tiers (playbook T17).
    setDailyOvertimeThresholdHoursText(
      minutesToHoursText(currentArrangement.overtime_daily_threshold_minutes)
    );
    setDoubletimeThresholdHoursText(
      minutesToHoursText(currentArrangement.doubletime_daily_threshold_minutes)
    );
    setDoubletimeMultiplierText(
      multiplierToText(currentArrangement.doubletime_multiplier)
    );
    setSeventhDayMultiplierText(
      multiplierToText(currentArrangement.seventh_day_multiplier)
    );
    setSeventhDayDoubletimeAfterHoursText(
      minutesToHoursText(
        currentArrangement.seventh_day_doubletime_after_minutes
      )
    );
    setWorkedHolidayMultiplierText(
      multiplierToText(currentArrangement.worked_holiday_multiplier)
    );
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
    setCurrency(currentArrangement.currency);
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
          householdWeekStartsOn,
          currentArrangement.rate_minor,
          currentArrangement.currency,
          typedRateMinor,
          // The SELECTED currency, not the stored one. `buildMidWeekConsequence`
          // has always compared `previousCurrency !== newCurrency`
          // (payArrangementForm.ts) but both args used to be
          // `currentArrangement.currency`, so the currency half could never
          // fire. This one argument IS the mid-week currency-change warning:
          // a flip on any day but the household's own week start splits the
          // week, and the API answers such a
          // week with the `currency_change` earnings arm rather than a total
          // (earningsService.ts) — better to say so before it's submitted.
          currency
        )
      : null;

  const formState: PayTermsFormState = {
    rateText,
    currency,
    effectiveDateISO,
    todayISO,
    overtimeThresholdHoursText,
    overtimeMultiplierText,
    dailyOvertimeThresholdHoursText,
    doubletimeThresholdHoursText,
    doubletimeMultiplierText,
    seventhDayMultiplierText,
    seventhDayDoubletimeAfterHoursText,
    workedHolidayMultiplierText,
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
          <Label>{t('changeSheet.currencyLabel')}</Label>
          <CurrencySelect
            value={currency}
            onChange={setCurrency}
            testIDPrefix="pay-change"
          />
        </View>

        <View className="gap-2">
          <Label>{t('changeSheet.rateLabel')}</Label>
          <View className="flex-row items-center gap-2">
            <Body
              testID="pay-change-currency-prefix"
              className="text-muted-foreground"
            >
              {currencySymbol(currency)}
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

        {/* 078's three further tiers, inside the same overtime block
            (`screens-pay-terms.md` §4.3). Daily overtime gets NO multiplier
            input: it is paid at the weekly `overtime_multiplier` above, and a
            second column for the same number is a second number that
            eventually disagrees. */}
        <View className="gap-2">
          <Label>{t('changeSheet.dailyOvertimeAfterLabel')}</Label>
          <Input
            testID="pay-change-daily-overtime-threshold-input"
            accessibilityLabel={t('changeSheet.dailyOvertimeAfterLabel')}
            value={dailyOvertimeThresholdHoursText}
            onChangeText={setDailyOvertimeThresholdHoursText}
            keyboardType="decimal-pad"
          />
          <Small className="text-muted-foreground">
            {t('changeSheet.dailyOvertimeHint')}
          </Small>
        </View>

        <View className="gap-2">
          <Label>{t('changeSheet.doubletimeAfterLabel')}</Label>
          <View className="flex-row gap-2">
            <Input
              testID="pay-change-doubletime-threshold-input"
              accessibilityLabel={t('changeSheet.doubletimeAfterLabel')}
              value={doubletimeThresholdHoursText}
              onChangeText={setDoubletimeThresholdHoursText}
              keyboardType="decimal-pad"
              className="flex-1"
            />
            <Input
              testID="pay-change-doubletime-multiplier-input"
              accessibilityLabel={t('changeSheet.doubletimePaidAtLabel')}
              value={doubletimeMultiplierText}
              onChangeText={setDoubletimeMultiplierText}
              keyboardType="decimal-pad"
              className="flex-1"
            />
          </View>
        </View>

        <View className="gap-2">
          <Label>{t('changeSheet.seventhDayFieldLabel')}</Label>
          <View className="flex-row gap-2">
            <Input
              testID="pay-change-seventh-day-multiplier-input"
              accessibilityLabel={t('changeSheet.seventhDayPaidAtLabel')}
              value={seventhDayMultiplierText}
              onChangeText={setSeventhDayMultiplierText}
              keyboardType="decimal-pad"
              className="flex-1"
            />
            <Input
              testID="pay-change-seventh-day-doubletime-after-input"
              accessibilityLabel={t(
                'changeSheet.seventhDayDoubletimeAfterLabel'
              )}
              value={seventhDayDoubletimeAfterHoursText}
              onChangeText={setSeventhDayDoubletimeAfterHoursText}
              keyboardType="decimal-pad"
              className="flex-1"
            />
          </View>
          <Small className="text-muted-foreground">
            {t('changeSheet.seventhDayHint')}
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

        {/* 3-E4's half of the holidays group (`screens-pay-terms.md` §4.3).
            WHICH holidays the family observes is a household-level toggle
            list and belongs to 3-U1 — this arrangement carries only what a
            worked one pays. */}
        <View className="gap-2">
          <Label>{t('changeSheet.workedHolidayPremiumFieldLabel')}</Label>
          <Input
            testID="pay-change-worked-holiday-multiplier-input"
            accessibilityLabel={t('changeSheet.workedHolidayPremiumFieldLabel')}
            value={workedHolidayMultiplierText}
            onChangeText={setWorkedHolidayMultiplierText}
            keyboardType="decimal-pad"
          />
          <Small className="text-muted-foreground">
            {t('changeSheet.workedHolidayPremiumHint')}
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
