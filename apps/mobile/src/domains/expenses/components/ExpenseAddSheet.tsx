/**
 * @module domains/expenses/components/ExpenseAddSheet
 *
 * The nanny's "Add an expense" quick-add (TIER0-CX-SPEC.md §6.1):
 * `BottomSheetBase`, `sheetId="expense-add"`, `fitContent`. A kind toggle
 * (Expense/Mileage), a date row, a description, and amount-or-miles
 * depending on kind. Also serves as the EDIT sheet for a still-`pending`
 * row the nanny owns (docs/11-MONEY.md §8) — pass `initialExpense` to seed
 * every field and swap the title/submit copy; omit it for a fresh add.
 *
 * Sheet-owns-values, screen-owns-mutation (the `PayChangeSheet`/
 * `ClockOutSheet` discipline): this component only builds and reports a
 * `CreateExpenseRequest` via `onSubmit`; the caller decides whether to
 * close the sheet, and only does so on success, so a refusal leaves every
 * typed field intact.
 *
 * Amount uses `parseMajorToMinor` (major-display normalisation on blur, the
 * same round-trip `PayChangeSheet`'s rate field does). Miles are validated
 * to ONE decimal place client-side via `parseMilesInput`, mirroring the
 * wire schema's `numeric(6,1)` column — a clear inline message beats
 * letting the server reject it.
 */
import type {
  CreateExpenseRequest,
  Expense,
} from '@steadily-nanny/shared-types/schemas/expense.schema';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { cn } from '@/lib/utils';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Body, H4, Label, Small } from '@/src/components/ui/typography';
import { currencySymbol } from '@/src/domains/pay/utils/currencySymbol';
import { localDateInZone } from '@/src/lib/localDate';
import {
  formatMoney,
  minorToMajorText,
  parseMajorToMinor,
} from '@/src/lib/money';
import { buildExpenseRequest } from '../utils/buildExpenseRequest';
import { parseMilesInput } from '../utils/miles';
import { ExpenseDateField } from './ExpenseDateField';

interface ExpenseAddSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (input: CreateExpenseRequest) => void;
  isSubmitting: boolean;
  /** Household-local today, "yyyy-mm-dd" — the date field's ceiling. */
  todayISO: string;
  /** IANA timezone — recomputes "today" at submit time so a sheet left open
   * across midnight submits today's real date, not a stale one (same
   * discipline as `PayChangeSheet`'s `handleSubmit`, review finding 11). */
  householdTimezone: string;
  currency: string;
  /** `pay_arrangement.mileage_rate_per_mile_minor` — null when unset. */
  mileageRateMinor?: number | null;
  /** Seeds every field and switches to edit copy — omit for a fresh add. */
  initialExpense?: Expense | null;
}

function KindChip({
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
      onPress={onPress}
    >
      <Text className={cn(selected ? undefined : 'text-foreground')}>
        {label}
      </Text>
    </Button>
  );
}

export function ExpenseAddSheet({
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
  todayISO,
  householdTimezone,
  currency,
  mileageRateMinor = null,
  initialExpense = null,
}: ExpenseAddSheetProps) {
  const { t } = useTranslation('expenses');
  const isEdit = initialExpense !== null;

  const [kind, setKind] = useState<'expense' | 'mileage'>('expense');
  const [dateISO, setDateISO] = useState(todayISO);
  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
  const [milesText, setMilesText] = useState('');

  // Re-seed every time the sheet opens — same re-seed-on-`visible` pattern
  // as `ClockOutSheet`/`PayChangeSheet` (it stays mounted between openings).
  useEffect(() => {
    if (!visible) return;
    if (initialExpense) {
      setKind(initialExpense.kind);
      setDateISO(initialExpense.local_date);
      setDescription(initialExpense.description);
      setAmountText(
        initialExpense.amount_minor !== null
          ? minorToMajorText(initialExpense.amount_minor)
          : ''
      );
      setMilesText(
        initialExpense.miles !== null ? String(initialExpense.miles) : ''
      );
    } else {
      setKind('expense');
      setDateISO(todayISO);
      setDescription('');
      setAmountText('');
      setMilesText('');
    }
  }, [visible, initialExpense, todayISO]);

  const amountInvalid =
    kind === 'expense' &&
    amountText.trim() !== '' &&
    parseMajorToMinor(amountText) === null;
  const milesInvalid =
    kind === 'mileage' &&
    milesText.trim() !== '' &&
    parseMilesInput(milesText) === null;

  const request = buildExpenseRequest({
    kind,
    localDateISO: dateISO,
    description,
    amountText,
    milesText,
    currency,
  });

  const handleSubmit = () => {
    // Recomputed HERE, not the `todayISO` prop closed over at render time —
    // same reasoning as `PayChangeSheet.handleSubmit` (review finding 11).
    // Only relevant for a fresh add (`dateISO` already defaults to today);
    // an edit keeps whatever date the nanny chose.
    const submitTodayISO = localDateInZone(householdTimezone);
    const finalDateISO =
      !isEdit && dateISO === todayISO ? submitTodayISO : dateISO;
    const finalRequest = buildExpenseRequest({
      kind,
      localDateISO: finalDateISO,
      description,
      amountText,
      milesText,
      currency,
    });
    if (!finalRequest) return;
    onSubmit(finalRequest);
  };

  return (
    <BottomSheetBase
      sheetId="expense-add"
      visible={visible}
      onDismiss={onDismiss}
      testID="expense-add-sheet"
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{isEdit ? t('addSheet.titleEdit') : t('addSheet.titleAdd')}</H4>

        <View className="flex-row flex-wrap gap-2">
          <KindChip
            testID="expense-add-kind-expense"
            selected={kind === 'expense'}
            label={t('addSheet.kindExpense')}
            onPress={() => setKind('expense')}
          />
          <KindChip
            testID="expense-add-kind-mileage"
            selected={kind === 'mileage'}
            label={t('addSheet.kindMileage')}
            onPress={() => setKind('mileage')}
          />
        </View>

        <ExpenseDateField
          testID="expense-add-date"
          value={dateISO}
          todayISO={todayISO}
          onChange={setDateISO}
        />

        <View className="gap-2">
          <Label>{t('addSheet.descriptionLabel')}</Label>
          <Input
            testID="expense-add-description-input"
            accessibilityLabel={t('addSheet.descriptionLabel')}
            value={description}
            onChangeText={setDescription}
            placeholder={
              kind === 'expense'
                ? t('addSheet.descriptionPlaceholderExpense')
                : t('addSheet.descriptionPlaceholderMileage')
            }
          />
        </View>

        {kind === 'expense' ? (
          <View className="gap-2">
            <Label>{t('addSheet.amountLabel')}</Label>
            <View className="flex-row items-center gap-2">
              <Body
                testID="expense-add-currency-prefix"
                className="text-muted-foreground"
              >
                {currencySymbol(currency)}
              </Body>
              <Input
                testID="expense-add-amount-input"
                accessibilityLabel={t('addSheet.amountLabel')}
                value={amountText}
                onChangeText={setAmountText}
                onBlur={() => {
                  const minor = parseMajorToMinor(amountText);
                  if (minor !== null) setAmountText(minorToMajorText(minor));
                }}
                keyboardType="decimal-pad"
                className="flex-1"
                error={amountInvalid}
              />
            </View>
            {amountInvalid ? (
              <Small
                testID="expense-add-amount-error"
                className="text-destructive"
              >
                {t('addSheet.amountError')}
              </Small>
            ) : null}
          </View>
        ) : (
          <View className="gap-2">
            <Label>{t('addSheet.milesLabel')}</Label>
            <View className="flex-row items-center gap-2">
              <Input
                testID="expense-add-miles-input"
                accessibilityLabel={t('addSheet.milesLabel')}
                value={milesText}
                onChangeText={setMilesText}
                keyboardType="decimal-pad"
                className="flex-1"
                error={milesInvalid}
              />
              <Body className="text-muted-foreground">
                {t('addSheet.milesSuffix')}
              </Body>
            </View>
            {milesInvalid ? (
              <Small
                testID="expense-add-miles-error"
                className="text-destructive"
              >
                {t('addSheet.milesPrecisionError')}
              </Small>
            ) : mileageRateMinor !== null ? (
              <Small
                testID="expense-add-mileage-rate-hint"
                className="text-muted-foreground"
              >
                {t('addSheet.mileageRateHint', {
                  rate: formatMoney(mileageRateMinor, currency),
                })}
              </Small>
            ) : (
              <Small
                testID="expense-add-mileage-rate-missing-hint"
                className="text-muted-foreground"
              >
                {t('addSheet.mileageRateMissingHint')}
              </Small>
            )}
          </View>
        )}

        <LoadingButton
          testID="expense-add-submit"
          label={isEdit ? t('addSheet.saveButton') : t('addSheet.submitButton')}
          isLoading={isSubmitting}
          disabled={!request}
          onPress={handleSubmit}
        />
      </View>
    </BottomSheetBase>
  );
}

export type { ExpenseAddSheetProps };
