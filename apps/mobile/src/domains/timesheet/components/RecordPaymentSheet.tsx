/**
 * @module domains/timesheet/components/RecordPaymentSheet
 *
 * "Mark as paid" — the parent recording that a week's wages actually moved.
 * `BottomSheetBase`, never a bare RN `<Modal>` (GOLDEN-FIXES #1), and it has
 * a text input, so the keyboard avoidance that sheet provides is the reason
 * this is not an `AlertDialog`.
 *
 * SHEET-OWNS-VALUES, SCREEN-OWNS-MUTATION (the `ExpenseAddSheet` /
 * `PayChangeSheet` / `ClockOutSheet` discipline): this component builds and
 * reports a `CreatePaymentInput` and nothing else. The caller decides whether
 * to close, and only closes on success — so a refusal (an over-payment, a
 * network failure) leaves every typed figure intact instead of making the
 * parent retype an amount they already got right.
 *
 * AMOUNT PREFILLS TO THE OUTSTANDING BALANCE, which is also echoed above the
 * input as its own `AmountRow` — asserting "I paid £X" needs a visible
 * balance to check the typed amount against, not just a silent prefill. The
 * overwhelmingly common action is "I have now paid the rest", and making
 * that one tap is the difference between a ledger people keep and a ledger
 * people abandon. It is an ordinary editable field, so a partial payment
 * costs one edit.
 *
 * Every amount goes through `parseMajorToMinor` (docs/11-MONEY.md §1) —
 * never `parseFloat(x) * 100`. It REFUSES rather than guesses: ".45" is not
 * 45p and not £45, it is a typo, and the field says so instead of writing a
 * number nobody typed into a payment record.
 *
 * The settlement DATE is a calendar day, not an instant — there is no
 * timezone to get wrong. It defaults to today and is recomputed at submit
 * from the household zone (a sheet left open across midnight must submit
 * today's real date, the same fix `ExpenseAddSheet.handleSubmit` documents).
 * A future date is REFUSED, not clamped: money that has not moved yet is not
 * a payment.
 */
import type { CreatePaymentInput } from '@steadily-nanny/shared-types/schemas/payment.schema';
import { PAYMENT_METHOD_NOTE_MAX } from '@steadily-nanny/shared-types/schemas/payment.schema';
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
import { AmountRow } from '@/src/domains/pay/components/AmountRow';
import { localDateInZone } from '@/src/lib/localDate';
import {
  currencySymbol,
  formatMoney,
  minorToMajorText,
  parseMajorToMinor,
} from '@/src/lib/money';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface RecordPaymentSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (input: CreatePaymentInput) => void;
  isSubmitting: boolean;
  /** What the week still has left to pay, minor units — the prefill. */
  outstandingMinor: number;
  currency: string;
  /** Household-local today, "yyyy-mm-dd" — the date field's ceiling. */
  todayISO: string;
  /** IANA zone, so submit recomputes "today" rather than trusting a prop
   * closed over at render time. */
  householdTimezone: string;
  carerName: string;
  weekRangeLabel: string;
  /**
   * The server's `PAYMENT_EXCEEDS_GROSS` figures, or null. Stated inline
   * rather than only as a toast: the parent needs to see WHICH ceiling they
   * hit while the amount they typed is still in front of them.
   */
  overPayment: { alreadyPaidMinor: number; grossMinor: number } | null;
  testID?: string;
}

/** Today or earlier, and a real "yyyy-mm-dd" — same refuse-don't-clamp
 * contract as `ExpenseDateField`. String comparison is safe and exact on
 * zero-padded ISO dates. */
function isValidSettlementDate(text: string, todayISO: string): boolean {
  const trimmed = text.trim();
  if (!ISO_DATE_RE.test(trimmed)) return false;
  const [y = 0, m = 0, d = 0] = trimmed.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Rejects "2026-02-31", which passes the regex and is not a day.
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return false;
  }
  return trimmed <= todayISO;
}

export function RecordPaymentSheet({
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
  outstandingMinor,
  currency,
  todayISO,
  householdTimezone,
  carerName,
  weekRangeLabel,
  overPayment,
  testID = 'hours-record-payment',
}: RecordPaymentSheetProps) {
  const { t } = useTranslation('pay');
  const { t: tHours } = useTranslation('hours');

  const [amountText, setAmountText] = useState('');
  const [dateChoice, setDateChoice] = useState<'today' | 'earlier'>('today');
  const [earlierDateText, setEarlierDateText] = useState('');
  const [methodNote, setMethodNote] = useState('');

  // Re-seed every time the sheet opens, from the CURRENT balance — the
  // re-seed-on-`visible` pattern `ClockOutSheet` / `PayChangeSheet` /
  // `ExpenseAddSheet` all use, because the sheet stays mounted between
  // openings. `outstandingMinor` is in the dependency array on purpose (it
  // is read in the body): a value listed but never read is exactly what
  // `bun run format`'s unsafe pass deletes, and one that is read but not
  // listed is what it adds — GOLDEN-FIXES #30. The `!visible` guard is what
  // keeps a background refetch from clobbering a half-typed amount, since
  // the sheet is only ever seeded while it is open.
  useEffect(() => {
    if (!visible) return;
    setAmountText(
      outstandingMinor > 0 ? minorToMajorText(outstandingMinor) : ''
    );
    setDateChoice('today');
    setEarlierDateText('');
    setMethodNote('');
  }, [visible, outstandingMinor]);

  const amountMinor = parseMajorToMinor(amountText);
  const amountInvalid =
    amountText.trim() !== '' && (amountMinor === null || amountMinor < 1);
  const dateInvalid =
    dateChoice === 'earlier' &&
    earlierDateText.trim() !== '' &&
    !isValidSettlementDate(earlierDateText, todayISO);
  const canSubmit =
    amountMinor !== null &&
    amountMinor >= 1 &&
    (dateChoice === 'today' ||
      isValidSettlementDate(earlierDateText, todayISO)) &&
    !isSubmitting;

  const handleSubmit = () => {
    if (!canSubmit || amountMinor === null) return;
    // Recomputed HERE, not the `todayISO` prop closed over at render time —
    // a sheet left open across midnight must not date the payment yesterday.
    const paidAt =
      dateChoice === 'today'
        ? localDateInZone(householdTimezone)
        : earlierDateText.trim();
    const trimmedNote = methodNote.trim();
    onSubmit({
      amount_minor: amountMinor,
      paid_at: paidAt,
      ...(trimmedNote ? { method_note: trimmedNote } : {}),
    });
  };

  return (
    <BottomSheetBase
      sheetId="hours-record-payment"
      visible={visible}
      onDismiss={onDismiss}
      testID={`${testID}-sheet`}
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{t('recordPaymentSheet.title')}</H4>
        <Small className="text-muted-foreground">
          {t('recordPaymentSheet.subtitle', {
            name: carerName,
            range: weekRangeLabel,
          })}
        </Small>

        {overPayment ? (
          <View
            testID={`${testID}-overpayment-error`}
            className="gap-2 rounded-cell bg-destructive/10 px-4 py-3"
          >
            {/* The figures are rendered as their own rows rather than
                interpolated into one sentence: they are the actionable part,
                and a parent scanning a red banner should find the two
                numbers without reading a paragraph. */}
            <Small className="text-destructive">
              {t('recordPaymentSheet.exceedsGrossTitle')}
            </Small>
            <AmountRow
              testID={`${testID}-overpayment-already-paid`}
              label={t('recordPaymentSheet.alreadyRecordedLabel')}
              value={formatMoney(overPayment.alreadyPaidMinor, currency)}
            />
            <AmountRow
              testID={`${testID}-overpayment-gross`}
              label={t('recordPaymentSheet.weekGrossLabel')}
              value={formatMoney(overPayment.grossMinor, currency)}
            />
          </View>
        ) : null}

        <AmountRow
          testID={`${testID}-outstanding`}
          label={t('recordPaymentSheet.outstandingLabel')}
          value={formatMoney(outstandingMinor, currency)}
        />

        <View className="gap-2">
          <Label>{t('recordPaymentSheet.amountLabel')}</Label>
          <View className="flex-row items-center gap-2">
            <Body
              testID={`${testID}-currency-prefix`}
              className="text-muted-foreground"
            >
              {currencySymbol(currency)}
            </Body>
            <Input
              testID={`${testID}-amount-input`}
              accessibilityLabel={t('recordPaymentSheet.amountLabel')}
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
              className="text-destructive"
            >
              {t('recordPaymentSheet.amountError')}
            </Small>
          ) : null}
        </View>

        <View className="gap-2">
          <Label>{t('recordPaymentSheet.dateLabel')}</Label>
          <View className="flex-row flex-wrap gap-2">
            <Button
              testID={`${testID}-date-chip-today`}
              variant={dateChoice === 'today' ? 'default' : 'outline'}
              onPress={() => setDateChoice('today')}
            >
              <Text
                className={cn(
                  dateChoice === 'today' ? undefined : 'text-foreground'
                )}
              >
                {t('recordPaymentSheet.chipToday', { date: todayISO })}
              </Text>
            </Button>
            <Button
              testID={`${testID}-date-chip-earlier`}
              variant={dateChoice === 'earlier' ? 'default' : 'outline'}
              onPress={() => setDateChoice('earlier')}
            >
              <Text
                className={cn(
                  dateChoice === 'earlier' ? undefined : 'text-foreground'
                )}
              >
                {t('recordPaymentSheet.chipEarlier')}
              </Text>
            </Button>
          </View>
          {dateChoice === 'earlier' ? (
            <>
              <Input
                testID={`${testID}-date-input`}
                accessibilityLabel={t('recordPaymentSheet.dateInputLabel')}
                value={earlierDateText}
                onChangeText={setEarlierDateText}
                placeholder={t('recordPaymentSheet.datePlaceholder')}
                autoCapitalize="none"
                error={dateInvalid}
              />
              {dateInvalid ? (
                <Small
                  testID={`${testID}-date-error`}
                  className="text-destructive"
                >
                  {t('recordPaymentSheet.dateInvalid')}
                </Small>
              ) : null}
            </>
          ) : null}
        </View>

        <View className="gap-2">
          <Label>{t('recordPaymentSheet.methodLabel')}</Label>
          <Input
            testID={`${testID}-method-input`}
            accessibilityLabel={t('recordPaymentSheet.methodLabel')}
            value={methodNote}
            onChangeText={setMethodNote}
            placeholder={t('recordPaymentSheet.methodPlaceholder')}
            maxLength={PAYMENT_METHOD_NOTE_MAX}
          />
        </View>

        <LoadingButton
          testID={`${testID}-submit`}
          label={t('recordPaymentSheet.submitButton')}
          isLoading={isSubmitting}
          disabled={!canSubmit}
          onPress={handleSubmit}
        />

        <Small testID={`${testID}-note`} className="text-muted-foreground">
          {tHours('paid.note')}
        </Small>
      </View>
    </BottomSheetBase>
  );
}

export type { RecordPaymentSheetProps };
