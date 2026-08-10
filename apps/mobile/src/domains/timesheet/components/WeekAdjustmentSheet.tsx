/**
 * @module domains/timesheet/components/WeekAdjustmentSheet
 *
 * The parent's one-off adjustment to a week's pay, staged just before
 * approval: a bonus, a reimbursement-shaped extra, or a deduction, plus the
 * reason the carer will read next to it. `BottomSheetBase`, never a bare RN
 * `<Modal>` (GOLDEN-FIXES #1) — and it has two text inputs, so the keyboard
 * avoidance that sheet provides is the reason this is not an `AlertDialog`.
 *
 * SHEET-OWNS-VALUES, SCREEN-OWNS-MUTATION (`RecordPaymentSheet` /
 * `ExpenseAddSheet` / `PayChangeSheet` discipline): this component builds and
 * reports `{ amount_minor, note }` and nothing else. `ParentWeekView` holds
 * the staged value, decides when to close, and sends it with the approval.
 *
 * THE CHIPS CARRY THE SIGN. `parseMajorToMinor` refuses a negative amount by
 * design (docs/11-MONEY.md §1 — this app has no signed-amount input), so the
 * field always holds the ABSOLUTE value and "Add"/"Take off" decides which
 * way it points. Typing "-20" is therefore an invalid amount, not a
 * deduction, which is exactly right: a minus sign smuggled into a number
 * field is a typo far more often than it is an intention.
 *
 * ERRORS ARE INLINE, NEVER TOASTS (GOLDEN-FIXES #40): a toast is invisible
 * behind an open sheet, and both refusals here — an unparseable amount, and a
 * deduction bigger than the week itself — are about a figure the parent is
 * still looking at. The deduction ceiling is NAMED rather than merely
 * refused, because "too big" without "than what" is not actionable.
 */
import { TIMESHEET_ADJUSTMENT_NOTE_MAX } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
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
import { AmountRow } from '@/src/domains/pay/components/AmountRow';
import {
  currencySymbol,
  formatMoney,
  minorToMajorText,
  parseMajorToMinor,
} from '@/src/lib/money';

interface StagedAdjustment {
  /** SIGNED minor units — negative is a deduction. */
  amount_minor: number;
  note: string;
}

interface WeekAdjustmentSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (input: StagedAdjustment) => void;
  /** Only supplied while EDITING an already-staged adjustment — its absence
   * is what hides the remove affordance. */
  onRemove?: () => void;
  isSubmitting?: boolean;
  /** The week's computed gross, minor units — the deduction ceiling and the
   * base the preview adds to. */
  computedGrossMinor: number;
  currency: string;
  carerName: string;
  weekRangeLabel: string;
  /** Prefills chip + absolute amount + note when re-opening on a staged
   * value. */
  initialAdjustment?: StagedAdjustment | null;
  testID?: string;
}

export function WeekAdjustmentSheet({
  visible,
  onDismiss,
  onSubmit,
  onRemove,
  isSubmitting = false,
  computedGrossMinor,
  currency,
  carerName,
  weekRangeLabel,
  initialAdjustment = null,
  testID = 'hours-week-adjustment',
}: WeekAdjustmentSheetProps) {
  const { t } = useTranslation('hours');

  const [direction, setDirection] = useState<'add' | 'deduct'>('add');
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');

  // Re-seed every time the sheet opens — the re-seed-on-`visible` pattern
  // `RecordPaymentSheet` / `ClockOutSheet` / `ExpenseAddSheet` all use,
  // because the sheet stays mounted between openings. The two scalars are
  // read in the body and listed in the array (GOLDEN-FIXES #30), rather than
  // the containing object: a fresh `{...}` identity from the parent would
  // otherwise clobber a half-typed amount mid-edit.
  const initialAmountMinor = initialAdjustment?.amount_minor;
  const initialNote = initialAdjustment?.note;
  useEffect(() => {
    if (!visible) return;
    setDirection(
      initialAmountMinor !== undefined && initialAmountMinor < 0
        ? 'deduct'
        : 'add'
    );
    setAmountText(
      initialAmountMinor === undefined
        ? ''
        : minorToMajorText(Math.abs(initialAmountMinor))
    );
    setNote(initialNote ?? '');
  }, [visible, initialAmountMinor, initialNote]);

  // Absolute value throughout — `parseMajorToMinor` caps at £999,999.99 and
  // returns null above it, so an over-max amount lands in `amountInvalid`
  // and needs no branch of its own.
  const amountMinor = parseMajorToMinor(amountText);
  const hasAmount = amountMinor !== null && amountMinor >= 1;
  const amountInvalid = amountText.trim() !== '' && !hasAmount;
  const signedMinor =
    amountMinor === null
      ? 0
      : direction === 'deduct'
        ? -amountMinor
        : amountMinor;
  const resultingGrossMinor = computedGrossMinor + signedMinor;
  // Refused, never clamped: a deduction bigger than the week would make the
  // gross negative, which is not a number this app is allowed to write.
  const exceedsGross = hasAmount && resultingGrossMinor < 0;
  const noteFilled = note.trim() !== '';
  const canSubmit = hasAmount && !exceedsGross && noteFilled && !isSubmitting;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({ amount_minor: signedMinor, note: note.trim() });
  };

  return (
    <BottomSheetBase
      sheetId="hours-week-adjustment"
      visible={visible}
      onDismiss={onDismiss}
      testID={`${testID}-sheet`}
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{t('adjustment.sheetTitle')}</H4>
        <Small className="text-muted-foreground">
          {t('adjustment.sheetSubtitle', {
            name: carerName,
            range: weekRangeLabel,
          })}
        </Small>

        <View className="gap-2">
          <Label>{t('adjustment.directionLabel')}</Label>
          <View className="flex-row flex-wrap gap-2">
            <Button
              testID={`${testID}-direction-add`}
              variant={direction === 'add' ? 'default' : 'outline'}
              onPress={() => setDirection('add')}
            >
              <Text
                className={cn(
                  direction === 'add' ? undefined : 'text-foreground'
                )}
              >
                {t('adjustment.chipAdd')}
              </Text>
            </Button>
            <Button
              testID={`${testID}-direction-deduct`}
              variant={direction === 'deduct' ? 'default' : 'outline'}
              onPress={() => setDirection('deduct')}
            >
              <Text
                className={cn(
                  direction === 'deduct' ? undefined : 'text-foreground'
                )}
              >
                {t('adjustment.chipDeduct')}
              </Text>
            </Button>
          </View>
        </View>

        <View className="gap-2">
          <Label>{t('adjustment.amountLabel')}</Label>
          <View className="flex-row items-center gap-2">
            <Body
              testID={`${testID}-currency-prefix`}
              className="text-muted-foreground"
            >
              {currencySymbol(currency)}
            </Body>
            <Input
              testID={`${testID}-amount-input`}
              accessibilityLabel={t('adjustment.amountLabel')}
              value={amountText}
              onChangeText={setAmountText}
              onBlur={() => {
                const minor = parseMajorToMinor(amountText);
                if (minor !== null) setAmountText(minorToMajorText(minor));
              }}
              keyboardType="decimal-pad"
              className="flex-1"
              error={amountInvalid || exceedsGross}
            />
          </View>
          {amountInvalid ? (
            <Small
              testID={`${testID}-amount-error`}
              className="text-destructive"
            >
              {t('adjustment.amountError')}
            </Small>
          ) : null}
          {exceedsGross ? (
            <Small
              testID={`${testID}-exceeds-error`}
              className="text-destructive"
            >
              {t('adjustment.exceedsGrossError', {
                gross: formatMoney(computedGrossMinor, currency),
              })}
            </Small>
          ) : null}
        </View>

        <View className="gap-2">
          <Label>{t('adjustment.reasonLabel')}</Label>
          <Textarea
            testID={`${testID}-note-input`}
            accessibilityLabel={t('adjustment.reasonLabel')}
            value={note}
            onChangeText={setNote}
            placeholder={t('adjustment.reasonPlaceholder')}
            maxLength={TIMESHEET_ADJUSTMENT_NOTE_MAX}
          />
          <Small className="text-muted-foreground">
            {t('adjustment.reasonHint')}
          </Small>
        </View>

        {hasAmount && !exceedsGross ? (
          <AmountRow
            testID={`${testID}-preview`}
            label={t('adjustment.previewLabel')}
            value={formatMoney(resultingGrossMinor, currency)}
            subLine={t('adjustment.previewWas', {
              gross: formatMoney(computedGrossMinor, currency),
            })}
          />
        ) : null}

        <LoadingButton
          testID={`${testID}-submit`}
          label={t('adjustment.saveButton')}
          isLoading={isSubmitting}
          disabled={!canSubmit}
          onPress={handleSubmit}
        />

        {/* No confirmation dialog: removing a STAGED adjustment changes
            nothing anyone has been told about yet, and it is one tap to add
            back. A confirm here would be ceremony over a reversible act. */}
        {onRemove ? (
          <Button
            testID={`${testID}-remove`}
            variant="ghost"
            size="sm"
            className="self-start"
            onPress={onRemove}
          >
            <Text className="text-destructive">
              {t('adjustment.removeButton')}
            </Text>
          </Button>
        ) : null}
      </View>
    </BottomSheetBase>
  );
}

export type { StagedAdjustment, WeekAdjustmentSheetProps };
