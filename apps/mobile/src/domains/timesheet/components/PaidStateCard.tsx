/**
 * @module domains/timesheet/components/PaidStateCard
 *
 * The other half of the weekly loop. The rest of the Hours screen answers
 * "what is this week WORTH"; this card answers "has it actually been PAID" —
 * a Paid / Partially paid / Unpaid badge, what has landed so far, what is
 * still outstanding, and the payments themselves.
 *
 * ONE component for both roles, deliberately. A carer and a parent must read
 * the same figures off the same ledger — two components would be two chances
 * for those figures to drift. The only difference is the action:
 * `onMarkPaidPress` is passed by the parent view and omitted everywhere else
 * (the carer, and a read-only helper), so "who may record a payment" is a
 * single prop rather than a role check duplicated in here.
 *
 * Renders NOTHING when `paidState` is null — a week with no server gross
 * (`no_arrangement`, `currency_change`, legacy `hours_only`, or a failed
 * earnings fetch) has no balance to state, and inventing a zero would tell a
 * nanny she is owed nothing. Same discipline as `ReimbursementsCard`'s
 * `totalMinor: number | null`. Also renders nothing for a genuinely
 * zero-value week with no payments: there is no settlement to talk about.
 *
 * `payments` is the ledger the server returned. The card never re-orders it
 * or re-derives its total from anything other than `paidState`, which is
 * itself derived once in `utils/paidState`.
 */
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { H4, Small } from '@/src/components/ui/typography';
import { AmountRow } from '@/src/domains/pay/components/AmountRow';
import { formatMoney } from '@/src/lib/money';
import { formatEarningsLongDate } from '../utils/earningsFormat';
import type { PaidStatus, WeekPaidState } from '../utils/paidState';

const BADGE_COPY_KEY: Record<PaidStatus, string> = {
  paid: 'paid.badgePaid',
  partial: 'paid.badgePartial',
  unpaid: 'paid.badgeUnpaid',
};

/** `secondary` (not `default`) for paid: a settled week is a quiet fact,
 * not a call to action. `outline` for unpaid keeps the destructive red for
 * things that are actually wrong — an unpaid approved week is normal. */
const BADGE_VARIANT: Record<PaidStatus, 'default' | 'secondary' | 'outline'> = {
  paid: 'secondary',
  partial: 'default',
  unpaid: 'outline',
};

interface PaidStateCardProps {
  /** `null` when the week has no server gross — the card then renders
   * nothing at all. Never default this with `?? 0` at a call site. */
  paidState: WeekPaidState | null;
  payments: Payment[];
  currency: string;
  /** Supplied by the PARENT view only. Its absence is what makes this card
   * read-only for the carer and for a read-only helper. */
  onMarkPaidPress?: () => void;
  /** Held down while a record-payment request is in flight. */
  isMarkPaidDisabled?: boolean;
  testID?: string;
}

export function PaidStateCard({
  paidState,
  payments,
  currency,
  onMarkPaidPress,
  isMarkPaidDisabled = false,
  testID = 'hours-paid-state',
}: PaidStateCardProps) {
  const { t } = useTranslation('hours');

  if (!paidState) return null;
  if (paidState.grossMinor === 0 && payments.length === 0) return null;

  const { status, paidMinor, balanceMinor } = paidState;
  // Nothing left to record — offering the action would only produce a
  // refusal the server has to write the copy for.
  const canMarkPaid = onMarkPaidPress !== undefined && balanceMinor > 0;

  return (
    <Card testID={testID} className="mt-4">
      <CardContent className="gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <H4>{t('paid.title')}</H4>
          <Badge variant={BADGE_VARIANT[status]}>
            <Text testID={`${testID}-badge`}>{t(BADGE_COPY_KEY[status])}</Text>
          </Badge>
        </View>

        <AmountRow
          testID={`${testID}-total`}
          label={t('paid.paidToDateLabel')}
          value={formatMoney(paidMinor, currency)}
        />
        {balanceMinor > 0 ? (
          <AmountRow
            testID={`${testID}-balance`}
            label={t('paid.balanceLabel')}
            value={formatMoney(balanceMinor, currency)}
          />
        ) : null}

        {payments.length > 0 ? (
          <View className="gap-3 rounded-cell bg-muted px-4 py-3">
            {payments.map(payment => (
              <AmountRow
                key={payment.id}
                testID={`${testID}-line-${payment.id}`}
                label={formatEarningsLongDate(payment.paid_at)}
                value={formatMoney(payment.amount_minor, currency)}
                subLine={payment.method_note ?? undefined}
              />
            ))}
          </View>
        ) : (
          <Small testID={`${testID}-empty`} className="text-muted-foreground">
            {t('paid.noPayments')}
          </Small>
        )}

        {canMarkPaid ? (
          <Button
            testID="hours-mark-paid-button"
            variant="outline"
            disabled={isMarkPaidDisabled}
            onPress={onMarkPaidPress}
          >
            <Text className="text-foreground">{t('paid.markPaidButton')}</Text>
          </Button>
        ) : null}

        <Small testID={`${testID}-note`} className="text-muted-foreground">
          {t('paid.note')}
        </Small>
      </CardContent>
    </Card>
  );
}

export type { PaidStateCardProps };
