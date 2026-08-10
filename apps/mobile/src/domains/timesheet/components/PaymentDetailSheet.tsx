/**
 * @module domains/timesheet/components/PaymentDetailSheet
 *
 * One payment's leaf. `BottomSheetBase`, never a bare RN `<Modal>` — a
 * `animationType="slide"` modal above the navigator can strand a transparent,
 * touch-blocking window on iOS (GOLDEN-FIXES #1).
 *
 * "Date the money moved" and "entered in Steadily" are two ADJACENT,
 * differently-labelled rows on purpose. They are different facts, and the gap
 * between them is the only signal a household has that a transfer went
 * missing or that a week was reconstructed from memory weeks later. Merging
 * them into one date would delete that signal.
 *
 * There is no edit, no delete and no void: `payments` is append-only
 * server-side (no PATCH route, no DELETE route — see
 * `apps/api/src/domains/pay/routes/paymentRoutes.ts`), and a correction is
 * recorded as another payment. The footer note says so rather than leaving
 * someone hunting for a control that does not exist.
 *
 * `created_at` is read off the ISO string rather than through a `Date` — the
 * server's own offset is the honest answer to "when was this entered", and
 * re-projecting it into the device zone would move a late-evening entry onto
 * the following day.
 */
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import { type Href, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import {
  Body,
  Caption,
  Figure28,
  H4,
  MetadataLabel,
} from '@/src/components/ui/typography';
import { formatMoney } from '@/src/lib/money';
import { formatEarningsLongDate } from '../utils/earningsFormat';
import { formatWeekRangeLabel, getWeekDates } from '../utils/week';

interface PaymentDetailSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** Null between dismissals — the sheet lives OUTSIDE the list, so nothing
   * about its dismissal depends on which row is still mounted. */
  payment: Payment | null;
  /** The joined week's Monday, or null when that timesheet is not in the
   * list. Drives whether the for-week row exists at all. */
  weekStart: string | null;
  /** The carer this went to. Null for a nanny reading her own record — she
   * does not need telling who she is. */
  paidToName: string | null;
  /** Resolved household member name, or null when `recorded_by` is null or
   * no longer resolvable. Never a raw uuid. */
  recordedByName: string | null;
  testID?: string;
}

/** Label over value. `onPress` is what makes a row a link — its absence is
 * why a plain fact needs no "read-only" copy beside it. */
function DetailRow({
  testID,
  label,
  value,
  onPress,
}: {
  testID: string;
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const content: ReactNode = (
    <>
      <MetadataLabel
        testID={`${testID}-label`}
        className="text-muted-foreground"
      >
        {label}
      </MetadataLabel>
      <Body
        testID={`${testID}-value`}
        className={onPress ? 'text-primary' : 'text-foreground'}
      >
        {value}
      </Body>
    </>
  );

  return onPress ? (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className="gap-1"
    >
      {content}
    </Pressable>
  ) : (
    <View testID={testID} className="gap-1">
      {content}
    </View>
  );
}

/** "20 August, 09:30" — read literally off the stored ISO string; see the
 * module header for why this is not a `Date` round-trip. */
function formatRecordedAt(createdAtISO: string): string {
  const date = formatEarningsLongDate(createdAtISO.slice(0, 10));
  const time = createdAtISO.slice(11, 16);
  return time ? `${date}, ${time}` : date;
}

export function PaymentDetailSheet({
  visible,
  onDismiss,
  payment,
  weekStart,
  paidToName,
  recordedByName,
  testID = 'payments-detail',
}: PaymentDetailSheetProps) {
  const { t } = useTranslation('hours');
  const router = useRouter();

  return (
    <BottomSheetBase
      sheetId="payment-detail"
      visible={visible}
      onDismiss={onDismiss}
      testID={testID}
      fitContent
      showCloseButton
    >
      {payment ? (
        <View className="gap-5 px-5 pb-4">
          <H4>{t('payments.detail.title')}</H4>

          <View className="gap-1">
            <MetadataLabel
              testID={`${testID}-amount-label`}
              className="text-muted-foreground"
            >
              {t('payments.recordedLabel')}
            </MetadataLabel>
            <Figure28 testID={`${testID}-amount`}>
              {formatMoney(payment.amount_minor, payment.currency)}
            </Figure28>
          </View>

          <DetailRow
            testID={`${testID}-paid-on`}
            label={t('payments.detail.paidOn')}
            value={formatEarningsLongDate(payment.paid_at)}
          />
          <DetailRow
            testID={`${testID}-recorded-on`}
            label={t('payments.detail.recordedOn')}
            value={formatRecordedAt(payment.created_at)}
          />

          {weekStart ? (
            <DetailRow
              testID={`${testID}-for-week`}
              label={t('payments.detail.forWeek')}
              value={formatWeekRangeLabel(getWeekDates(weekStart))}
              onPress={() =>
                router.push(
                  `/(private)/(tabs)/hours?weekStart=${weekStart}` as Href
                )
              }
            />
          ) : null}

          {paidToName ? (
            <DetailRow
              testID={`${testID}-paid-to`}
              label={t('payments.detail.paidTo')}
              value={paidToName}
            />
          ) : null}

          <DetailRow
            testID={`${testID}-recorded-by`}
            label={t('payments.detail.recordedBy')}
            value={recordedByName ?? t('payments.detail.recordedByGone')}
          />
          <DetailRow
            testID={`${testID}-method`}
            label={t('payments.detail.method')}
            value={payment.method_note ?? t('payments.detail.methodUnstated')}
          />

          <Caption
            testID={`${testID}-append-only`}
            className="text-muted-foreground"
          >
            {t('payments.detail.appendOnly')}
          </Caption>
        </View>
      ) : null}
    </BottomSheetBase>
  );
}

export type { PaymentDetailSheetProps };
