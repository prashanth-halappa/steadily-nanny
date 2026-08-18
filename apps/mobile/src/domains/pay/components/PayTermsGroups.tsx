/**
 * @module domains/pay/components/PayTermsGroups
 *
 * Every OPTIONAL term, as D-3's progressive groups (spec §4.1's "TERM GROUPS"
 * card, §4.3's contents). The required core — currency, rate, effective date,
 * cancellation choice — stays on the screen that owns it, always open, never
 * collapsible: they are the terms with no honest blank state, and separating
 * them from the expanders is what makes the expanders safe to leave closed.
 *
 * **One component, two screens.** `PaySetupScreen` and `PayChangeSheet` used
 * to carry ~250 lines of identical field markup each, which is exactly how the
 * T10 parity gap opened (the change sheet validated its date, setup did not).
 * There is now one copy, parameterised by `testIDPrefix` alone — the spec's
 * `PayTermsForm` in everything but name, minus the `mode` flag it does not
 * need: §4.2's "a group opens when it has a value" derives the setup-vs-change
 * difference from `seed` being `null`, so no mode is threaded anywhere.
 *
 * **`defaultOpen` reads the SEED, not the live values.** `TermGroup` captures
 * `defaultOpen` in a `useState` initializer, and `PayChangeSheet` stays mounted
 * between openings and seeds its fields from an effect — so a `defaultOpen`
 * derived from the live form state would be read one render too early, before
 * the seeding effect had run, and every group would open closed. The seed
 * arrangement is available at first render and never changes, which makes it
 * the only honest source for this.
 *
 * **The collapsed summary is `buildTermRows`' own output**, not a second
 * formatter — §4.2: "a closed sheet must read as a complete contract", which
 * is only true if the closed row is worded identically to the read-only
 * document. Rather than re-format the values here, the live form state is run
 * back through `buildCreatePayArrangementRequest` into a candidate
 * `PayArrangement` and handed to the same `buildTermRows` the parent's terms
 * card and the nanny's card use.
 */

import { COMMON_DEFAULTS_PRESET } from '@steadily-nanny/shared-types/payTermsPresets';
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import {
  Banknote,
  CalendarCheck,
  Car,
  Clock,
  FileText,
  PartyPopper,
  Sun,
  X,
} from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useThemeColors } from '@/lib/design-tokens';
import { Check } from '@/lib/icons/Check';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H4, Label, Small } from '@/src/components/ui/typography';
import { currencySymbol, formatMoney } from '@/src/lib/money';
import { useAuthStore } from '@/src/store/auth';
import {
  buildCreatePayArrangementRequest,
  type PayTermsFormState,
  type StipendFormRow,
} from '../utils/payArrangementForm';
import { buildTermRows } from '../utils/termRows';
import { TermGroup } from './TermGroup';

/** A candidate arrangement needs every non-term column to exist; none of them
 * reach `buildTermRows`' output, so a first-ever setup (no seed) supplies
 * these blanks rather than the component branching on "is there a seed" at
 * every read. */
const BLANK_ARRANGEMENT: PayArrangement = {
  id: '',
  household_id: '',
  carer_id: '',
  rate_minor: 0,
  bill_rate_minor: null,
  currency: 'USD',
  overtime_threshold_minutes: null,
  overtime_multiplier: 1.5,
  guaranteed_minutes_per_week: null,
  pto_entitlement_minutes_per_year: null,
  mileage_rate_per_mile_minor: null,
  cancellation_paid_within_hours: null,
  valid_from: '1970-01-01',
  valid_to: null,
  carer_display_name: '',
  note: null,
  created_by: null,
  created_at: '1970-01-01T00:00:00.000Z',
};

/** Each cadence names its own key literally: a computed
 * `t(\`outsideWages.cadence${…}\`)` is invisible to the locale-key resolution
 * guard (`src/i18n/__tests__/locale-key-resolution.test.ts`), and a key no
 * test can see is a key that silently stops resolving in Spanish. */
const CADENCES = [
  { value: 'weekly', labelKey: 'outsideWages.cadenceWeekly' },
  { value: 'monthly', labelKey: 'outsideWages.cadenceMonthly' },
  { value: 'annual', labelKey: 'outsideWages.cadenceAnnual' },
] as const;

export interface PayTermsGroupsProps {
  /** `pay-setup` or `pay-change` — the screen's own testID namespace. */
  testIDPrefix: string;
  state: PayTermsFormState;
  onChange: (patch: Partial<PayTermsFormState>) => void;
  /**
   * The arrangement the form was seeded from, or `null` on a first-ever
   * setup. Decides which groups open (§4.2) and supplies D-6's stored weekly
   * equivalent — never used to READ a live value.
   */
  seed: PayArrangement | null;
}

/**
 * The live form state as the read-only document would word it.
 *
 * ponytail: the summaries hold their last VALID wording while a field is
 * mid-edit, because one unparsable multiplier makes the whole request `null`.
 * The group is necessarily open when that happens and the field itself shows
 * what was typed, so the held summary is never the only thing on screen. Give
 * `buildCreatePayArrangementRequest` a per-field error result if that ever
 * stops being true.
 */
function summaryValues(
  state: PayTermsFormState,
  seed: PayArrangement | null,
  t: (key: string, params?: Record<string, unknown>) => string
): Record<string, string> {
  const base = seed ?? BLANK_ARRANGEMENT;
  // The required core lives OUTSIDE these groups, so a blank rate or an
  // unanswered cancellation choice must not blank every group's summary.
  const request = buildCreatePayArrangementRequest({
    ...state,
    rateText: '0',
    cancellationChoice: 'none',
    effectiveDateISO: state.todayISO,
  });
  const candidate: PayArrangement = request
    ? {
        ...base,
        ...request,
        currency: request.currency ?? base.currency,
        note: request.note ?? null,
      }
    : base;

  const notSet = t('notSet');
  return Object.fromEntries(
    buildTermRows(candidate, t).map(row => [row.key, row.value ?? notSet])
  );
}

/**
 * §5.2's liability moment, in full. `BottomSheetBase` because it is the only
 * sanctioned sheet (GOLDEN-FIXES #1), including from inside another one.
 *
 * D-52, owner verbatim: *"We should never call out anything about
 * jurisdiction presets anywhere in the app… Just say most common values are
 * input. Make sure that you are complying with local laws and put the onus on
 * the user."* Every string this renders comes from `preset.*` in the
 * catalogue: the values are "the most common values", nothing names a place
 * they came from, and the disclaimer plus D-7's checkbox put verifying
 * compliance with local law on the family.
 *
 * There is no review date and no staleness warning here any more (D-52
 * removed the metadata behind them): a "reviewed in August 2026" line is a
 * claim that somebody checked these figures against a body of law, which is
 * exactly the conclusion this app never owns.
 */
function PresetConfirmSheet({
  visible,
  onDismiss,
  onConfirm,
}: {
  visible: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('pay');
  const colors = useThemeColors();
  const [accepted, setAccepted] = useState(false);

  return (
    <BottomSheetBase
      sheetId="pay-preset-confirm"
      visible={visible}
      onDismiss={onDismiss}
      testID="pay-preset-sheet"
      fitContent
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{t('preset.title')}</H4>
        <Body className="text-foreground">{t('preset.body')}</Body>

        {/* §5.2: the disclaimer is Body in mutedStrong, never the smallest
            faintest text on screen — text that transfers responsibility for a
            legal outcome does not get to be a footnote. */}
        <Body testID="pay-preset-disclaimer" className="text-muted-strong">
          {t('preset.disclaimer')}
        </Body>

        {/* A plain Pressable rather than `components/ui/checkbox` for the same
            reason TermGroup is not a Collapsible: `@rn-primitives/checkbox`
            ships JSX-preserved source that bun:test's loader cannot parse, and
            this slice's job is a tested terms form, not a toolchain fix. The
            44pt row target and accessibilityRole are unchanged. */}
        <Pressable
          testID="pay-preset-checkbox"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accepted }}
          accessibilityLabel={t('preset.checkbox')}
          onPress={() => setAccepted(a => !a)}
          className="min-h-11 flex-row items-center gap-3"
        >
          <View
            className="h-5 w-5 items-center justify-center rounded border-1.5"
            style={{
              borderColor: accepted ? colors.primary : colors.borderStrong,
              backgroundColor: accepted ? colors.primary : 'transparent',
            }}
          >
            {accepted ? (
              <Check size={14} className="text-primary-foreground" />
            ) : null}
          </View>
          <Body className="flex-1 text-foreground">{t('preset.checkbox')}</Body>
        </Pressable>

        <Button
          testID="pay-preset-confirm"
          size="lg"
          disabled={!accepted}
          onPress={() => {
            if (!accepted) return;
            setAccepted(false);
            onConfirm();
          }}
        >
          <Text>{t('preset.confirm')}</Text>
        </Button>
        <Button
          testID="pay-preset-cancel"
          variant="ghost"
          onPress={() => {
            setAccepted(false);
            onDismiss();
          }}
        >
          <Text className="text-foreground">{t('preset.cancel')}</Text>
        </Button>
      </View>
    </BottomSheetBase>
  );
}

export function PayTermsGroups({
  testIDPrefix,
  state,
  onChange,
  seed,
}: PayTermsGroupsProps) {
  const { t } = useTranslation('pay');
  const [presetSheetOpen, setPresetSheetOpen] = useState(false);

  const summary = summaryValues(state, seed, t);
  const stipends = state.stipends ?? [];

  const seededTerms = seed?.terms;
  const seededRecurring = seededTerms?.recurring;
  const inWritingFields = [
    state.noticePeriodWeeksText,
    state.probationDaysText,
    state.dutiesText,
    state.drivingText,
  ];
  const inWritingFilled = inWritingFields.filter(
    field => (field ?? '').trim() !== ''
  ).length;
  // Read from the SEED, not from `inWritingFilled` — see the module doc on why
  // `defaultOpen` cannot depend on state a later effect fills in.
  const seededInWriting =
    seededTerms !== undefined &&
    ['notice_period_days', 'probation_days', 'duties', 'driving'].some(
      key => seededTerms[key] != null
    );

  const setStipends = (next: StipendFormRow[]) => onChange({ stipends: next });
  const patchStipend = (index: number, patch: Partial<StipendFormRow>) =>
    setStipends(
      stipends.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );

  /**
   * §5.1: applying a preset FILLS FIELDS and saves nothing. The values land in
   * the same text fields a parent would have typed, so everything downstream
   * (validation, the diff, the consequence card) treats them as one ordinary
   * edit. §5.2's recorded confirmation is the one extra: `terms.preset` names
   * which preset, at which version, and who took responsibility for it.
   */
  const applyPreset = () => {
    const { values } = COMMON_DEFAULTS_PRESET;
    onChange({
      overtimeThresholdHoursText: String(
        values.overtime_threshold_minutes / 60
      ),
      overtimeMultiplierText: String(values.overtime_multiplier),
      dailyOvertimeThresholdHoursText: String(
        values.overtime_daily_threshold_minutes / 60
      ),
      doubletimeThresholdHoursText: String(
        values.doubletime_daily_threshold_minutes / 60
      ),
      doubletimeMultiplierText: String(values.doubletime_multiplier),
      seventhDayMultiplierText: String(values.seventh_day_multiplier),
      seventhDayDoubletimeAfterHoursText: String(
        values.seventh_day_doubletime_after_minutes / 60
      ),
      presetStamp: {
        id: COMMON_DEFAULTS_PRESET.id,
        version: COMMON_DEFAULTS_PRESET.version,
        applied_at: new Date().toISOString(),
        // Read at confirm time rather than subscribed to: this is a fact about
        // the tap, not a value the form re-renders on.
        confirmed_by: useAuthStore.getState().user?.id ?? '',
      },
    });
    setPresetSheetOpen(false);
  };

  return (
    <View className="gap-2">
      <Small className="px-1 text-muted-foreground">
        {t('termGroups.heading')}
      </Small>

      <TermGroup
        icon={Clock}
        label={t('termGroups.overtime')}
        collapsedSummary={summary.overtime ?? t('notSet')}
        defaultOpen={
          seed !== null &&
          (seed.overtime_threshold_minutes !== null ||
            seed.overtime_daily_threshold_minutes != null ||
            seed.doubletime_daily_threshold_minutes != null ||
            seed.seventh_day_multiplier != null)
        }
        testID={`${testIDPrefix}-group-overtime`}
      >
        <View className="gap-2">
          <Label>{t('changeSheet.overtimeAfterLabel')}</Label>
          <View className="flex-row gap-2">
            <Input
              testID={`${testIDPrefix}-overtime-threshold-input`}
              accessibilityLabel={t('changeSheet.overtimeAfterLabel')}
              value={state.overtimeThresholdHoursText}
              onChangeText={text =>
                onChange({ overtimeThresholdHoursText: text })
              }
              keyboardType="decimal-pad"
              className="flex-1"
            />
            <Input
              testID={`${testIDPrefix}-overtime-multiplier-input`}
              accessibilityLabel={t('changeSheet.overtimePaidAtLabel')}
              value={state.overtimeMultiplierText}
              onChangeText={text => onChange({ overtimeMultiplierText: text })}
              keyboardType="decimal-pad"
              className="flex-1"
            />
          </View>
          <Small
            testID={`${testIDPrefix}-overtime-hint`}
            className="text-muted-foreground"
          >
            {t('changeSheet.overtimeHint')}
          </Small>
          {(() => {
            const thresholdTrimmed = state.overtimeThresholdHoursText.trim();
            const multiplierTrimmed = state.overtimeMultiplierText.trim();
            if (thresholdTrimmed === '' || multiplierTrimmed === '') {
              return null;
            }
            const threshold = Number(thresholdTrimmed);
            const multiplier = Number(multiplierTrimmed);
            if (!Number.isFinite(threshold) || !Number.isFinite(multiplier)) {
              return null;
            }
            if (threshold <= 40 && multiplier >= 1.5) {
              return null;
            }
            return (
              <Small
                testID={`${testIDPrefix}-overtime-floor-caution`}
                className="text-muted-foreground"
              >
                {t('changeSheet.overtimeFloorCaution')}
              </Small>
            );
          })()}
        </View>

        {/* 078's three further tiers. Daily overtime gets NO multiplier input:
            it is paid at the weekly `overtime_multiplier` above, and a second
            column for the same number is a second number that eventually
            disagrees. No field here is ever DISABLED — see TermGroup's module
            doc for why enablement is group-level only. */}
        <View className="gap-2">
          <Label>{t('changeSheet.dailyOvertimeAfterLabel')}</Label>
          <Input
            testID={`${testIDPrefix}-daily-overtime-threshold-input`}
            accessibilityLabel={t('changeSheet.dailyOvertimeAfterLabel')}
            value={state.dailyOvertimeThresholdHoursText}
            onChangeText={text =>
              onChange({ dailyOvertimeThresholdHoursText: text })
            }
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
              testID={`${testIDPrefix}-doubletime-threshold-input`}
              accessibilityLabel={t('changeSheet.doubletimeAfterLabel')}
              value={state.doubletimeThresholdHoursText}
              onChangeText={text =>
                onChange({ doubletimeThresholdHoursText: text })
              }
              keyboardType="decimal-pad"
              className="flex-1"
            />
            <Input
              testID={`${testIDPrefix}-doubletime-multiplier-input`}
              accessibilityLabel={t('changeSheet.doubletimePaidAtLabel')}
              value={state.doubletimeMultiplierText}
              onChangeText={text =>
                onChange({ doubletimeMultiplierText: text })
              }
              keyboardType="decimal-pad"
              className="flex-1"
            />
          </View>
        </View>

        <View className="gap-2">
          <Label>{t('changeSheet.seventhDayFieldLabel')}</Label>
          <View className="flex-row gap-2">
            <Input
              testID={`${testIDPrefix}-seventh-day-multiplier-input`}
              accessibilityLabel={t('changeSheet.seventhDayPaidAtLabel')}
              value={state.seventhDayMultiplierText}
              onChangeText={text =>
                onChange({ seventhDayMultiplierText: text })
              }
              keyboardType="decimal-pad"
              className="flex-1"
            />
            <Input
              testID={`${testIDPrefix}-seventh-day-doubletime-after-input`}
              accessibilityLabel={t(
                'changeSheet.seventhDayDoubletimeAfterLabel'
              )}
              value={state.seventhDayDoubletimeAfterHoursText}
              onChangeText={text =>
                onChange({ seventhDayDoubletimeAfterHoursText: text })
              }
              keyboardType="decimal-pad"
              className="flex-1"
            />
          </View>
          <Small className="text-muted-foreground">
            {t('changeSheet.seventhDayHint')}
          </Small>
        </View>

        {/* §5.1: presets never lead. The offer sits INSIDE the group it would
            fill, after the fields, not on a template screen in front of the
            form. Only this group carries one (§5.4). */}
        <Button
          testID={`${testIDPrefix}-preset-button`}
          variant="ghost"
          size="sm"
          className="self-start"
          onPress={() => setPresetSheetOpen(true)}
        >
          <Text className="text-primary">{t('preset.button')}</Text>
        </Button>
        {state.presetStamp ? (
          <Small
            testID={`${testIDPrefix}-preset-applied-note`}
            className="text-muted-strong"
          >
            {t('preset.appliedNote')}
          </Small>
        ) : null}
      </TermGroup>

      <TermGroup
        icon={CalendarCheck}
        label={t('termGroups.guaranteedHours')}
        collapsedSummary={summary.guaranteedHours ?? t('notSet')}
        defaultOpen={seed?.guaranteed_minutes_per_week != null}
        testID={`${testIDPrefix}-group-guaranteed-hours`}
      >
        <View className="gap-2">
          <Label>{t('changeSheet.guaranteedHoursFieldLabel')}</Label>
          <Input
            testID={`${testIDPrefix}-guaranteed-hours-input`}
            accessibilityLabel={t('changeSheet.guaranteedHoursFieldLabel')}
            value={state.guaranteedHoursText}
            onChangeText={text => onChange({ guaranteedHoursText: text })}
            keyboardType="decimal-pad"
          />
          {/* D-6/§10. FORBIDDEN REFACTOR: this is the server's
              `weekly_equivalent_minor`, computed by the engine's own
              day-and-week splitter. Do not "simplify" it to `rate × hours` on
              the client — that formula is only wrong on arrangements WITH
              overtime, so it passes every test written against a no-overtime
              fixture and then tells a family $1,400 for a week payroll prices
              at $1,540. It renders only for the CURRENTLY STORED arrangement;
              a live figure for a not-yet-submitted edit would need a round
              trip per keystroke and is deliberately not attempted. */}
          {seed?.weekly_equivalent_minor != null &&
          seed.guaranteed_minutes_per_week != null ? (
            <Body
              testID={`${testIDPrefix}-weekly-equivalent`}
              className="text-muted-strong"
            >
              {t('termGroups.weeklyEquivalent', {
                amount: formatMoney(
                  seed.weekly_equivalent_minor,
                  seed.currency
                ),
                hours: seed.guaranteed_minutes_per_week / 60,
              })}
            </Body>
          ) : null}
        </View>
      </TermGroup>

      <TermGroup
        icon={Sun}
        label={t('termGroups.pto')}
        collapsedSummary={summary.pto ?? t('notSet')}
        defaultOpen={seed?.pto_entitlement_minutes_per_year != null}
        testID={`${testIDPrefix}-group-pto`}
      >
        <View className="gap-2">
          <Label>{t('changeSheet.ptoFieldLabel')}</Label>
          <Input
            testID={`${testIDPrefix}-pto-hours-input`}
            accessibilityLabel={t('changeSheet.ptoFieldLabel')}
            value={state.ptoHoursPerYearText}
            onChangeText={text => onChange({ ptoHoursPerYearText: text })}
            keyboardType="decimal-pad"
          />
          <Small className="text-muted-foreground">
            {t('changeSheet.ptoHint')}
          </Small>
        </View>
      </TermGroup>

      {/* The arrangement's half of the holidays group — BOTH terms. WHICH
          dates the family observes is a household-level toggle list (3-E4's
          own surface); what those dates are worth is a term of HER
          employment, because a second carer may have agreed differently
          against the same list. Two fields, and they answer two different
          days: 3-E4's premium is for a holiday she WORKED, 3-E5's credit is
          for one nobody did. The engine keeps them mutually exclusive per
          date, so a family may set either, both, or neither. */}
      <TermGroup
        icon={PartyPopper}
        label={t('termGroups.holidays')}
        collapsedSummary={summary.workedHolidayPremium ?? t('notSet')}
        defaultOpen={
          seed?.worked_holiday_multiplier != null ||
          seed?.holiday_hours_minutes != null
        }
        testID={`${testIDPrefix}-group-holidays`}
      >
        <Small className="text-muted-foreground">
          {t('changeSheet.holidayCalendarHint')}
        </Small>
        <View className="gap-2">
          <Label>{t('changeSheet.workedHolidayPremiumFieldLabel')}</Label>
          <Input
            testID={`${testIDPrefix}-worked-holiday-multiplier-input`}
            accessibilityLabel={t('changeSheet.workedHolidayPremiumFieldLabel')}
            value={state.workedHolidayMultiplierText}
            onChangeText={text =>
              onChange({ workedHolidayMultiplierText: text })
            }
            keyboardType="decimal-pad"
          />
          <Small className="text-muted-foreground">
            {t('changeSheet.workedHolidayPremiumHint')}
          </Small>
        </View>

        {/* 3-E5 / §5 D-53. Hours, not a multiplier: a holiday nobody worked
            has no hours of its own to multiply, which is exactly why 3-E4
            could not answer this and why it needed a column. */}
        <View className="gap-2">
          <Label>{t('changeSheet.paidHolidayHoursFieldLabel')}</Label>
          <Input
            testID={`${testIDPrefix}-holiday-hours-input`}
            accessibilityLabel={t('changeSheet.paidHolidayHoursFieldLabel')}
            value={state.holidayHoursText}
            onChangeText={text => onChange({ holidayHoursText: text })}
            keyboardType="decimal-pad"
          />
          <Small className="text-muted-foreground">
            {t('changeSheet.paidHolidayHoursHint')}
          </Small>
        </View>
      </TermGroup>

      <TermGroup
        icon={Car}
        label={t('termGroups.mileage')}
        collapsedSummary={summary.mileage ?? t('notSet')}
        defaultOpen={seed?.mileage_rate_per_mile_minor != null}
        testID={`${testIDPrefix}-group-mileage`}
      >
        <View className="gap-2">
          <Label>{t('changeSheet.mileageFieldLabel')}</Label>
          <Input
            testID={`${testIDPrefix}-mileage-rate-input`}
            accessibilityLabel={t('changeSheet.mileageFieldLabel')}
            value={state.mileageRateText}
            onChangeText={text => onChange({ mileageRateText: text })}
            keyboardType="decimal-pad"
          />
          <Small className="text-muted-foreground">
            {t('changeSheet.mileageHint')}
          </Small>
        </View>
      </TermGroup>

      {/* D-13. Paid outside the hourly wage and never added to the week's
          gross — the hint says so out loud, because a family that assumes
          otherwise is reading every week's total as higher than it is. */}
      <TermGroup
        icon={Banknote}
        label={t('termGroups.outsideWages')}
        collapsedSummary={
          stipends.length === 0
            ? t('notSet')
            : t('outsideWages.summary', { count: stipends.length })
        }
        defaultOpen={
          Array.isArray(seededRecurring) && seededRecurring.length > 0
        }
        testID={`${testIDPrefix}-group-outside-wages`}
      >
        {stipends.map((row, index) => (
          <View
            // The rows have no stable id of their own — the index IS the
            // identity here, and a removal rebuilds the list from it.
            // biome-ignore lint/suspicious/noArrayIndexKey: index is the row identity
            key={index}
            className="gap-2"
          >
            <View className="flex-row items-end gap-2">
              <View className="flex-1 gap-2">
                <Label>{t('outsideWages.labelFieldLabel')}</Label>
                <Input
                  testID={`${testIDPrefix}-stipend-label-${index}`}
                  accessibilityLabel={t('outsideWages.labelFieldLabel')}
                  value={row.label}
                  onChangeText={text => patchStipend(index, { label: text })}
                  placeholder={t('outsideWages.labelPlaceholder')}
                />
              </View>
              <Pressable
                testID={`${testIDPrefix}-stipend-remove-${index}`}
                accessibilityRole="button"
                accessibilityLabel={t('outsideWages.removeRow')}
                onPress={() =>
                  setStipends(stipends.filter((_, i) => i !== index))
                }
                className="h-11 w-11 items-center justify-center"
              >
                <X size={18} className="text-muted-foreground" />
              </Pressable>
            </View>
            <Label>{t('outsideWages.amountFieldLabel')}</Label>
            <View className="flex-row items-center gap-2">
              <Body className="text-muted-foreground">
                {currencySymbol(state.currency)}
              </Body>
              <Input
                testID={`${testIDPrefix}-stipend-amount-${index}`}
                accessibilityLabel={t('outsideWages.amountFieldLabel')}
                value={row.amountText}
                onChangeText={text => patchStipend(index, { amountText: text })}
                keyboardType="decimal-pad"
                className="flex-1"
              />
            </View>
            <View className="flex-row flex-wrap gap-2">
              {CADENCES.map(({ value, labelKey }) => (
                <Button
                  key={value}
                  testID={`${testIDPrefix}-stipend-cadence-${index}-${value}`}
                  variant={row.cadence === value ? 'default' : 'outline'}
                  size="sm"
                  onPress={() => patchStipend(index, { cadence: value })}
                >
                  <Text
                    className={
                      row.cadence === value ? undefined : 'text-foreground'
                    }
                  >
                    {t(labelKey)}
                  </Text>
                </Button>
              ))}
            </View>
          </View>
        ))}
        <Button
          testID={`${testIDPrefix}-stipend-add`}
          variant="ghost"
          size="sm"
          className="self-start"
          onPress={() =>
            setStipends([
              ...stipends,
              { label: '', amountText: '', cadence: 'weekly' },
            ])
          }
        >
          <Text className="text-primary">{t('outsideWages.addRow')}</Text>
        </Button>
        <Small className="text-muted-foreground">
          {t('outsideWages.hint')}
        </Small>
      </TermGroup>

      {/* T9. Documentation of the agreement and nothing more: it feeds no
          pricing, selects no preset, and is never pre-filled (§5.3). Live-in
          conditions are household-conditional and are not in this pass. */}
      <TermGroup
        icon={FileText}
        label={t('termGroups.inWriting')}
        collapsedSummary={
          inWritingFilled === 0
            ? t('notSet')
            : t('inWriting.summary', {
                filled: inWritingFilled,
                total: inWritingFields.length,
              })
        }
        defaultOpen={seededInWriting}
        testID={`${testIDPrefix}-group-in-writing`}
      >
        <View className="gap-2">
          <Label>{t('inWriting.noticePeriodLabel')}</Label>
          <Input
            testID={`${testIDPrefix}-notice-period-input`}
            accessibilityLabel={t('inWriting.noticePeriodLabel')}
            value={state.noticePeriodWeeksText ?? ''}
            onChangeText={text => onChange({ noticePeriodWeeksText: text })}
            keyboardType="decimal-pad"
          />
        </View>
        <View className="gap-2">
          <Label>{t('inWriting.probationLabel')}</Label>
          <Input
            testID={`${testIDPrefix}-probation-input`}
            accessibilityLabel={t('inWriting.probationLabel')}
            value={state.probationDaysText ?? ''}
            onChangeText={text => onChange({ probationDaysText: text })}
            keyboardType="number-pad"
          />
        </View>
        <View className="gap-2">
          <Label>{t('inWriting.dutiesLabel')}</Label>
          <Textarea
            testID={`${testIDPrefix}-duties-input`}
            accessibilityLabel={t('inWriting.dutiesLabel')}
            value={state.dutiesText ?? ''}
            onChangeText={text => onChange({ dutiesText: text })}
            placeholder={t('inWriting.dutiesPlaceholder')}
          />
        </View>
        <View className="gap-2">
          <Label>{t('inWriting.drivingLabel')}</Label>
          <Textarea
            testID={`${testIDPrefix}-driving-input`}
            accessibilityLabel={t('inWriting.drivingLabel')}
            value={state.drivingText ?? ''}
            onChangeText={text => onChange({ drivingText: text })}
            placeholder={t('inWriting.drivingPlaceholder')}
          />
        </View>
        <Small className="text-muted-foreground">{t('inWriting.hint')}</Small>
      </TermGroup>

      <PresetConfirmSheet
        visible={presetSheetOpen}
        onDismiss={() => setPresetSheetOpen(false)}
        onConfirm={applyPreset}
      />
    </View>
  );
}
