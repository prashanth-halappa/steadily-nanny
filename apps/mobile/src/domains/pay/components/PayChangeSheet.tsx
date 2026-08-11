/**
 * @module domains/pay/components/PayChangeSheet
 *
 * "Change terms" — the required core (currency, rate, effective date,
 * cancellation choice) always open at the top, every optional term behind a
 * `TermGroup` (`PayTermsGroups`, D-3). D-16 replaced the old no-future-dates
 * rule: a scheduled change is the ordinary case now, bounded at 12 months out
 * instead of at today.
 *
 * Sheet-owns-values, screen-owns-mutation (the `ClockOutSheet` discipline,
 * `NannyWeekView.tsx`'s `handleSaveCorrection`): this component only builds
 * and reports a `CreatePayArrangementRequest` via `onSubmit`; the caller
 * decides whether to close the sheet, and only does so on success — a
 * refusal (a bad value, a network error) leaves every typed field intact so
 * the parent doesn't have to retype the whole form.
 *
 * **One state object, not twenty-five `useState`s.** Every field lives in a
 * single `PayTermsFormState` so the whole form can be handed to
 * `PayTermsGroups` (and re-seeded) as one value. The alternative — a setter
 * per field, threaded through a shared groups component — is how a new column
 * gets added to one screen and forgotten on the other, which is playbook T17's
 * exact failure mode.
 *
 * SIMPLIFICATION (documented, not silent): the spec's backdating hint is meant
 * to appear "only when a past date is chosen and the affected week is already
 * approved". No hook here knows whether that week is approved, so
 * `EffectiveDateField` renders the hint on any past date — a wider net, never
 * a wrong one (an unapproved week just recomputes silently, which makes the
 * hint inapplicable rather than misleading).
 */

import type {
  CreatePayArrangementRequest,
  PayArrangement,
} from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { cn } from '@/lib/utils';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
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
  isWeekStartDay,
  type PayTermsFormState,
  readTermsBag,
} from '../utils/payArrangementForm';
import {
  buildTermsChangeConsequence,
  buildTermsDiff,
} from '../utils/termsDiff';
import { CurrencySelect } from './CurrencySelect';
import { EffectiveDateField } from './EffectiveDateField';
import { PayScheduleFields } from './PayScheduleFields';
import { PayTermsGroups } from './PayTermsGroups';

interface PayChangeSheetProps {
  /**
   * `change` is a parent writing a new arrangement over an existing one.
   * `propose` is 3-O's terms proposal — the SAME form, which is the whole
   * point (`screens-pay-terms.md` §4: "Setup, change, and 3-O's nanny
   * proposal are one form rendered in three modes"). Had 3-O grown a second
   * terms form, the two surfaces would have drifted on wording inside a
   * release. The mode changes the header, the submit label, and whether the
   * consequence card renders. Nothing else.
   */
  mode?: 'change' | 'propose';
  /** Who will read the proposal — named in `propose`'s subtitle. */
  counterpartyName?: string;
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (input: CreatePayArrangementRequest) => void;
  isSubmitting: boolean;
  /** The last submit's refusal, stated INSIDE the sheet: a toast (or an
   * inline error behind it) is not visible under an open BottomSheetBase
   * (GOLDEN-FIXES #40). */
  submitError?: string | null;
  /** The sheet only ever adjusts an existing arrangement — the "first
   * arrangement ever" case is `PaySetupScreen`, a full screen, not this
   * sheet. Fields seed from this. */
  currentArrangement: PayArrangement;
  /** For the cancellation-hours default when the current arrangement has no
   * per-nanny window set — the household's fallback column. */
  householdCancellationDefaultHours: number;
  /** Household-local today, "yyyy-mm-dd" — injectable for tests. Seeds the
   * date field and bounds the backdating hint and the 12-month horizon; the
   * ACTUAL submitted date is recomputed fresh at submit time from
   * `householdTimezone` when the parent left it untouched (review finding 11
   * — see `handleSubmit`). */
  todayISO: string;
  /** IANA timezone — recomputes "today" at submit time so a sheet left open
   * across midnight never submits a stale date (review finding 11). */
  householdTimezone: string;
  /**
   * The date the form OPENS on, when it should not be today: a counter
   * pre-fills the start date the other side proposed, so answering a
   * Monday-start offer on a Friday does not silently move the start to
   * Friday. Omitted, the field seeds to `todayISO` as it always did.
   */
  initialEffectiveDateISO?: string;
  /** Household `week_starts_on` (0=Sunday..6=Saturday). Decides which
   * effective dates split a week, and so whether §7.3's consequence card
   * shows — a Monday literal would warn a Sunday-start household on exactly
   * the wrong day. */
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

/**
 * The current arrangement as form text. Every column the row carries is
 * seeded, including the ones this sheet's parent never touches — a change
 * that only adjusts the rate must re-send everything else unchanged, or the
 * new (append-only) row silently drops the terms it didn't restate (T17).
 */
function seedFormState(
  arrangement: PayArrangement,
  householdCancellationDefaultHours: number,
  todayISO: string,
  initialEffectiveDateISO?: string
): PayTermsFormState {
  return {
    rateText: minorToMajorText(arrangement.rate_minor),
    currency: arrangement.currency,
    effectiveDateISO: initialEffectiveDateISO ?? todayISO,
    todayISO,
    overtimeThresholdHoursText: minutesToHoursText(
      arrangement.overtime_threshold_minutes
    ),
    overtimeMultiplierText: String(arrangement.overtime_multiplier),
    dailyOvertimeThresholdHoursText: minutesToHoursText(
      arrangement.overtime_daily_threshold_minutes
    ),
    doubletimeThresholdHoursText: minutesToHoursText(
      arrangement.doubletime_daily_threshold_minutes
    ),
    doubletimeMultiplierText: multiplierToText(
      arrangement.doubletime_multiplier
    ),
    seventhDayMultiplierText: multiplierToText(
      arrangement.seventh_day_multiplier
    ),
    seventhDayDoubletimeAfterHoursText: minutesToHoursText(
      arrangement.seventh_day_doubletime_after_minutes
    ),
    workedHolidayMultiplierText: multiplierToText(
      arrangement.worked_holiday_multiplier
    ),
    holidayHoursText: minutesToHoursText(arrangement.holiday_hours_minutes),
    guaranteedHoursText: minutesToHoursText(
      arrangement.guaranteed_minutes_per_week
    ),
    ptoHoursPerYearText: minutesToHoursText(
      arrangement.pto_entitlement_minutes_per_year
    ),
    mileageRateText:
      arrangement.mileage_rate_per_mile_minor === null
        ? ''
        : minorToMajorText(arrangement.mileage_rate_per_mile_minor),
    cancellationChoice:
      arrangement.cancellation_paid_within_hours === null ? 'none' : 'window',
    cancellationHoursText:
      arrangement.cancellation_paid_within_hours !== null
        ? String(arrangement.cancellation_paid_within_hours)
        : householdCancellationDefaultHours > 0
          ? String(householdCancellationDefaultHours)
          : '',
    note: '',
    currentOvertimeMultiplier: arrangement.overtime_multiplier,
    // 082's pay schedule, same re-seed-every-field reason as every other
    // term above (playbook T17): a change that only touches the rate must
    // re-send the pay schedule unchanged, or the new append-only row
    // silently drops what the family already set.
    payFrequency: arrangement.pay_frequency ?? '',
    payDayOfWeekText:
      arrangement.pay_day_of_week == null
        ? ''
        : String(arrangement.pay_day_of_week),
    payDayOfMonthText:
      arrangement.pay_day_of_month == null
        ? ''
        : String(arrangement.pay_day_of_month),
    ...readTermsBag(arrangement.terms),
  };
}

export function PayChangeSheet({
  mode = 'change',
  counterpartyName,
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
  submitError = null,
  currentArrangement,
  householdCancellationDefaultHours,
  todayISO,
  initialEffectiveDateISO,
  householdTimezone,
  householdWeekStartsOn,
}: PayChangeSheetProps) {
  const { t } = useTranslation('pay');
  const proposing = mode === 'propose';
  const testIDPrefix = proposing ? 'pay-propose' : 'pay-change';
  // Literal `t()` calls per branch — see `AcceptTermsSheet` for why a ternary
  // INSIDE `t(...)` hides the second key from the locale-key guard.
  const title = proposing ? t('proposeSheet.title') : t('changeSheet.title');
  const submitLabel = proposing
    ? t('proposeSheet.submitButton')
    : t('changeSheet.submitButton');

  // Seeded from the arrangement, NOT `getDeviceCurrency()`: an existing
  // arrangement's currency is a stored fact about the employment, and the
  // device of whoever opens this sheet says nothing about it.
  const [form, setForm] = useState<PayTermsFormState>(() =>
    seedFormState(
      currentArrangement,
      householdCancellationDefaultHours,
      todayISO,
      initialEffectiveDateISO
    )
  );
  const patch = (next: Partial<PayTermsFormState>) =>
    setForm(current => ({ ...current, ...next }));

  // A ref, not a dependency: the seeding effect below needs today's date but
  // must NOT re-run when it changes. A sheet left open across midnight that
  // re-seeded itself would wipe a half-typed form under the parent — the
  // submitted date is recomputed in `handleSubmit` instead (review finding 11).
  const todayRef = useRef(todayISO);
  todayRef.current = todayISO;

  // Re-seed every time the sheet opens, from the CURRENT arrangement — a
  // "change" usually adjusts one term, so starting from what's already
  // agreed is friendlier than a blank form. Mirrors ClockOutSheet's
  // re-seed-on-`visible` pattern (it stays mounted between openings).
  useEffect(() => {
    if (!visible) return;
    setForm(
      seedFormState(
        currentArrangement,
        householdCancellationDefaultHours,
        todayRef.current,
        initialEffectiveDateISO
      )
    );
  }, [
    visible,
    currentArrangement,
    householdCancellationDefaultHours,
    initialEffectiveDateISO,
  ]);

  // Render-time only — drives the submit button's enabled state. This value
  // must NOT be what gets submitted (review finding 11).
  const request = buildCreatePayArrangementRequest(form);

  // T11 / §7.3: a sentence per CHANGED term, from the same `buildTermsDiff`
  // the version history renders — one function, so the history can never
  // describe a change differently from how it was reviewed (§8.5).
  // A proposal prices NOTHING — it is a message about money, never a record
  // of it — so the consequence card has nothing true to say here.
  const consequences =
    request && !proposing
      ? buildTermsChangeConsequence(
          buildTermsDiff(
            currentArrangement,
            {
              ...currentArrangement,
              ...request,
              currency: request.currency ?? currentArrangement.currency,
              note: request.note ?? null,
            },
            t
          ),
          isWeekStartDay(form.effectiveDateISO, householdWeekStartsOn)
        )
      : [];

  const handleSubmit = () => {
    // Recomputed HERE, not read from the `todayISO` prop closed over at
    // render time: a sheet left open across midnight must submit today's
    // real date, not whatever "today" was when it was opened (review
    // finding 11). Only the UNTOUCHED default moves — a date the parent
    // typed is theirs, whatever the clock did since.
    const submitTodayISO = localDateInZone(householdTimezone);
    const submitRequest = buildCreatePayArrangementRequest({
      ...form,
      effectiveDateISO:
        form.effectiveDateISO === todayISO
          ? submitTodayISO
          : form.effectiveDateISO,
      todayISO: submitTodayISO,
    });
    if (!submitRequest) return;
    onSubmit(submitRequest);
  };

  return (
    <BottomSheetBase
      sheetId={testIDPrefix}
      visible={visible}
      onDismiss={onDismiss}
      testID={`${testIDPrefix}-sheet`}
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{title}</H4>
        {proposing ? (
          <Small testID="pay-propose-subtitle" className="text-muted-strong">
            {t('proposeSheet.subtitle', { name: counterpartyName ?? '' })}
          </Small>
        ) : null}

        <View className="gap-2">
          <Label>{t('changeSheet.currencyLabel')}</Label>
          <CurrencySelect
            value={form.currency}
            onChange={currency => patch({ currency })}
            testIDPrefix={testIDPrefix}
          />
        </View>

        <View className="gap-2">
          <Label>{t('changeSheet.rateLabel')}</Label>
          <View className="flex-row items-center gap-2">
            <Body
              testID={`${testIDPrefix}-currency-prefix`}
              className="text-muted-foreground"
            >
              {currencySymbol(form.currency)}
            </Body>
            <Input
              testID={`${testIDPrefix}-rate-input`}
              accessibilityLabel={t('changeSheet.rateLabel')}
              value={form.rateText}
              onChangeText={rateText => patch({ rateText })}
              onBlur={() => {
                const minor = parseMajorToMinor(form.rateText);
                if (minor !== null) {
                  patch({ rateText: minorToMajorText(minor) });
                }
              }}
              keyboardType="decimal-pad"
              className="flex-1"
            />
          </View>
        </View>

        <EffectiveDateField
          testIDPrefix={testIDPrefix}
          value={form.effectiveDateISO}
          onChange={effectiveDateISO => patch({ effectiveDateISO })}
          todayISO={todayISO}
        />

        {/* §7.3: every consequence sentence, stacked and never merged, on a
            tone="attention" card in mutedStrong (Rule M — mutedForeground
            fails AA on surfaceAttention). Inline, never a toast (GOLDEN #40). */}
        {consequences.length > 0 ? (
          <Card testID={`${testIDPrefix}-consequence-card`} tone="attention">
            <View className="gap-2 p-4">
              {consequences.map((consequence, index) => (
                <Small
                  key={consequence.key}
                  testID={`${testIDPrefix}-consequence-${index}`}
                  className="text-muted-strong"
                >
                  {t(consequence.key, consequence.params)}
                </Small>
              ))}
            </View>
          </Card>
        ) : null}

        <View className="gap-2">
          <Label>{t('changeSheet.cancellationsFieldLabel')}</Label>
          <View className="flex-row flex-wrap gap-2">
            <Button
              testID={`${testIDPrefix}-cancellation-chip-window`}
              variant={
                form.cancellationChoice === 'window' ? 'default' : 'outline'
              }
              size="sm"
              onPress={() => patch({ cancellationChoice: 'window' })}
            >
              <Text
                className={cn(
                  form.cancellationChoice === 'window'
                    ? undefined
                    : 'text-foreground'
                )}
              >
                {t('changeSheet.cancellationWindowChip')}
              </Text>
            </Button>
            <Button
              testID={`${testIDPrefix}-cancellation-chip-none`}
              variant={
                form.cancellationChoice === 'none' ? 'default' : 'outline'
              }
              size="sm"
              onPress={() => patch({ cancellationChoice: 'none' })}
            >
              <Text
                className={cn(
                  form.cancellationChoice === 'none'
                    ? undefined
                    : 'text-foreground'
                )}
              >
                {t('changeSheet.cancellationNoneChip')}
              </Text>
            </Button>
          </View>
          {form.cancellationChoice === 'window' ? (
            <Input
              testID={`${testIDPrefix}-cancellation-hours-input`}
              accessibilityLabel={t('changeSheet.cancellationHoursLabel')}
              value={form.cancellationHoursText}
              onChangeText={cancellationHoursText =>
                patch({ cancellationHoursText })
              }
              keyboardType="number-pad"
            />
          ) : null}
        </View>

        <PayTermsGroups
          testIDPrefix={testIDPrefix}
          state={form}
          onChange={patch}
          seed={currentArrangement}
        />

        {/* 082's pay schedule (D-17, T7 reversal) — presentation only, not
            part of PayTermsGroups' D-3 expanders (spec §4.3 lists it as its
            own, always-visible block). */}
        <PayScheduleFields
          testIDPrefix={testIDPrefix}
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
            testID={`${testIDPrefix}-note-input`}
            accessibilityLabel={t('changeSheet.noteLabel')}
            value={form.note}
            onChangeText={note => patch({ note })}
            placeholder={t('changeSheet.notePlaceholder')}
          />
        </View>

        {submitError ? (
          <Small
            testID={`${testIDPrefix}-submit-error`}
            className="text-destructive"
          >
            {submitError}
          </Small>
        ) : null}
        <LoadingButton
          testID={`${testIDPrefix}-submit`}
          label={submitLabel}
          isLoading={isSubmitting}
          disabled={!request}
          onPress={handleSubmit}
        />
      </View>
    </BottomSheetBase>
  );
}
