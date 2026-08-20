/**
 * @module domains/timesheet/components/PaymentCorrectionSheet
 *
 * "Correct this payment" — the parent un-recording money that never moved, or
 * moved once and was entered twice (D-20, attention spec §4.1). The sibling of
 * `RecordPaymentSheet` in every respect: `BottomSheetBase`, never a bare RN
 * `<Modal>` (GOLDEN-FIXES #1), and the same SHEET-OWNS-VALUES,
 * SCREEN-OWNS-MUTATION split — this component builds a
 * `CreatePaymentCorrectionInput` and nothing else. The caller closes on
 * success only, so a refusal leaves the typed figure and the typed reason
 * exactly where they were.
 *
 * IT ADDS A ROW; IT NEVER EDITS ONE. The original keeps its full amount
 * forever — that is the whole of the note under the button, and it is the
 * reason this sheet is safe to give a parent at all.
 *
 * AMOUNT PREFILLS TO THE ORIGINAL'S FULL FIGURE. The overwhelmingly common
 * correction is "that was recorded twice", which is a whole-row reversal; a
 * partial (the £462 transfer of which only £120 belonged to this week) costs
 * one edit, exactly as `RecordPaymentSheet`'s balance prefill does.
 *
 * THE FIELD IS A POSITIVE MAGNITUDE, and `parseMajorToMinor` is the only way
 * in (docs/11-MONEY.md §1) — never `parseFloat(x) * 100`. The server owns the
 * sign flip (`paymentCommandService.correct`): asking a human to type a minus
 * to un-record a payment is how a correction ends up ADDING money to a week.
 *
 * A REVERSAL LARGER THAN THE ORIGINAL IS REFUSED, NOT CLAMPED — here against
 * the row's own amount, and again server-side against what is LEFT of it after
 * any earlier partial correction. Only the server can know the second figure,
 * which is why its refusal renders inline in this sheet with its own numbers
 * (GOLDEN-FIXES #40 — a toast over an open sheet is invisible).
 *
 * THE REASON IS REQUIRED. It is the only thing that makes a reversal readable
 * a year later, when the pair of rows is all anyone has. Whitespace is not a
 * reason; submit stays withheld until there is one.
 *
 * The correction's DATE is the day it is recorded, recomputed at submit from
 * the household zone (a sheet left open across midnight must not date the
 * correction yesterday). There is no date picker: unlike a payment, a
 * correction is not a claim about when money moved — it is a claim about when
 * the record was fixed.
 */
import type {
  CreatePaymentCorrectionInput,
  Payment,
} from '@steadily-nanny/shared-types/schemas/payment.schema';
import { PAYMENT_CORRECTION_REASON_MAX } from '@steadily-nanny/shared-types/schemas/payment.schema';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Card, CardContent } from '@/src/components/ui/card';
import { Input } from '@/src/components/ui/input';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Body, H4, Label, Small } from '@/src/components/ui/typography';
import { AmountRow } from '@/src/domains/pay/components/AmountRow';
import { localDateInZone } from '@/src/lib/localDate';
import {
  currencySymbol,
  formatMoney,
  minorToMajorText,
  parseMajorToMinor,
} from '@/src/lib/money';
import { formatEarningsLongDate } from '../utils/earningsFormat';

/**
 * What the server refused and why. `exceeds_original` carries ITS figures —
 * `remainingMinor` is what a second correction is measured against, and only
 * the server (under 085's lock) knows it, so the sheet states the server's
 * numbers rather than re-deriving them from a local ledger.
 */
export type PaymentCorrectionRefusal =
  | {
      reason: 'exceeds_original';
      originalAmountMinor: number;
      remainingMinor: number;
    }
  | { reason: 'not_correctable' };

interface PaymentCorrectionSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (input: CreatePaymentCorrectionInput) => void;
  isSubmitting: boolean;
  /** The row being reversed. Null between dismissals — the sheet lives
   * OUTSIDE the ledger, so nothing about it depends on which row is mounted. */
  payment: Payment | null;
  /** IANA zone, so submit recomputes "today" rather than trusting a value
   * closed over at render time. */
  householdTimezone: string;
  /** The server's refusal, or null. Stated inline, never as a toast. */
  refusal: PaymentCorrectionRefusal | null;
  testID?: string;
}

export function PaymentCorrectionSheet({
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
  payment,
  householdTimezone,
  refusal,
  testID = 'hours-correct-payment',
}: PaymentCorrectionSheetProps) {
  const { t } = useTranslation('pay');

  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');

  // Re-seed every time the sheet opens, from the CURRENT row — the
  // re-seed-on-`visible` pattern `RecordPaymentSheet` documents, because the
  // sheet stays mounted between openings. The `!visible` guard is what keeps
  // a background refetch from clobbering a half-typed reversal.
  const originalMinor = payment?.amount_minor ?? 0;
  useEffect(() => {
    if (!visible) return;
    setAmountText(originalMinor > 0 ? minorToMajorText(originalMinor) : '');
    setReason('');
  }, [visible, originalMinor]);

  const amountMinor = parseMajorToMinor(amountText);
  const exceedsOriginal = amountMinor !== null && amountMinor > originalMinor;
  const amountInvalid =
    amountText.trim() !== '' &&
    (amountMinor === null || amountMinor < 1 || exceedsOriginal);
  const trimmedReason = reason.trim();
  const canSubmit =
    payment !== null &&
    amountMinor !== null &&
    amountMinor >= 1 &&
    !exceedsOriginal &&
    trimmedReason !== '' &&
    !isSubmitting;

  const handleSubmit = () => {
    if (!canSubmit || amountMinor === null) return;
    onSubmit({
      // POSITIVE magnitude — the server negates it. See the module doc.
      amount_minor: amountMinor,
      paid_at: localDateInZone(householdTimezone),
      reason: trimmedReason,
    });
  };

  return (
    <BottomSheetBase
      sheetId="hours-correct-payment"
      visible={visible}
      onDismiss={onDismiss}
      testID={`${testID}-sheet`}
      fitContent
      showCloseButton
    >
      {payment ? (
        <View className="gap-4 px-6 pb-4">
          <H4>{t('correctPaymentSheet.title')}</H4>

          {/* The row being corrected. An `AmountRow` rather than one
              interpolated sentence: the figure is the thing the parent is
              checking themselves against, and it renders through the same
              money primitive as every other amount in this block. */}
          <AmountRow
            testID={`${testID}-original`}
            label={
              payment.method_note
                ? t('correctPaymentSheet.originalWithMethod', {
                    date: formatEarningsLongDate(payment.paid_at),
                    method: payment.method_note,
                  })
                : t('correctPaymentSheet.original', {
                    date: formatEarningsLongDate(payment.paid_at),
                  })
            }
            value={formatMoney(payment.amount_minor, payment.currency)}
          />

          {refusal ? (
            <Card testID={`${testID}-refusal`} tone="critical">
              <CardContent className="gap-2">
                <Small className="text-foreground">
                  {refusal.reason === 'exceeds_original'
                    ? t('correctPaymentSheet.exceedsOriginalTitle')
                    : t('correctPaymentSheet.notCorrectableTitle')}
                </Small>
                {/* Figures ONLY on the arm that has them. A "not correctable"
                  refusal invents no number to fill the space — a fabricated
                  0.00 on a money surface is worse than silence. */}
                {refusal.reason === 'exceeds_original' ? (
                  <>
                    <AmountRow
                      testID={`${testID}-refusal-original`}
                      label={t('correctPaymentSheet.originalAmountLabel')}
                      value={formatMoney(
                        refusal.originalAmountMinor,
                        payment.currency
                      )}
                    />
                    <AmountRow
                      testID={`${testID}-refusal-remaining`}
                      label={t('correctPaymentSheet.remainingLabel')}
                      value={formatMoney(
                        refusal.remainingMinor,
                        payment.currency
                      )}
                    />
                  </>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <View className="gap-2">
            <Label>{t('correctPaymentSheet.amountLabel')}</Label>
            <View className="flex-row items-center gap-2">
              <Body
                testID={`${testID}-currency-prefix`}
                className="text-muted-foreground"
              >
                {currencySymbol(payment.currency)}
              </Body>
              <Input
                testID={`${testID}-amount-input`}
                accessibilityLabel={t('correctPaymentSheet.amountLabel')}
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
                testID={`${testID}-amount-error`}
                className="text-error-inline-text"
              >
                {exceedsOriginal
                  ? t('correctPaymentSheet.exceedsOriginalError')
                  : t('correctPaymentSheet.amountError')}
              </Small>
            ) : null}
          </View>

          <View className="gap-2">
            <Label>{t('correctPaymentSheet.reasonLabel')}</Label>
            <Input
              testID={`${testID}-reason-input`}
              accessibilityLabel={t('correctPaymentSheet.reasonLabel')}
              value={reason}
              onChangeText={setReason}
              placeholder={t('correctPaymentSheet.reasonPlaceholder')}
              maxLength={PAYMENT_CORRECTION_REASON_MAX}
            />
          </View>

          <Small testID={`${testID}-note`} className="text-muted-foreground">
            {t('correctPaymentSheet.note')}
          </Small>

          <LoadingButton
            testID={`${testID}-submit`}
            label={t('correctPaymentSheet.submitButton')}
            isLoading={isSubmitting}
            disabled={!canSubmit}
            onPress={handleSubmit}
          />
        </View>
      ) : null}
    </BottomSheetBase>
  );
}

export type { PaymentCorrectionSheetProps };
