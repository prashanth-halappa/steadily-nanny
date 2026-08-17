/**
 * @module domains/setup/components/InviteOfferSummary
 *
 * What the parent is about to offer, on the invite screen — the same rows the
 * nanny will read on My pay, built from the same `AmountRow` and the same
 * `pay` keys.
 *
 * It used to be one hand-built line, "{{rate}} · starts {{date}}", which
 * silently dropped the cancellation term the parent had just been forced to
 * decide. A parent set a 24-hour cancellation fee, saw a summary that
 * mentioned only the rate and the start date, and could not tell whether the
 * nanny was agreeing to the fee or whether it would have to be raised in
 * conversation later. Two surfaces describing one offer must not disagree
 * about what is in it.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Small } from '@/src/components/ui/typography';
import { AmountRow } from '@/src/domains/pay/components/AmountRow';

interface InviteOfferSummaryProps {
  testID?: string;
  rate: string;
  startDate: string;
  cancellationPaidWithinHours: number | null | undefined;
}

export function InviteOfferSummary({
  testID = 'invite-offer-summary',
  rate,
  startDate,
  cancellationPaidWithinHours,
}: InviteOfferSummaryProps) {
  const { t } = useTranslation(['pay', 'household']);

  return (
    <View testID={testID} className="gap-2">
      <AmountRow
        testID="invite-offer-rate-row"
        label={t('changeSheet.rateLabel')}
        value={rate}
      />
      <AmountRow
        testID="invite-offer-cancellations-row"
        label={t('terms.cancellationsLabel')}
        value={
          cancellationPaidWithinHours == null
            ? null
            : t('terms.cancellationsValue', {
                hours: cancellationPaidWithinHours,
              })
        }
        valueWhenNull={t('noCancellationPay')}
      />
      <Small testID="invite-offer-starts" className="text-muted-foreground">
        {t('household:invite.offer.starts', { date: startDate })}
      </Small>
    </View>
  );
}
