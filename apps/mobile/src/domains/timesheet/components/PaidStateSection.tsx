/**
 * @module domains/timesheet/components/PaidStateSection
 *
 * The other half of the weekly loop. The earnings section above it answers
 * "what is this week WORTH"; this one answers "has it actually been PAID" —
 * a Paid / Partially paid / Unpaid badge, what has landed so far, what is
 * still outstanding, and the payments themselves.
 *
 * It is a SECTION, not a card: `WeekMoneyCard` owns the one card the money
 * block gets (docs/design/screens-hours.md §5 — gross, breakdown link and
 * paid state are one idea and were two cards a screen apart). It renders no
 * ground and no elevation of its own; separation from the earnings section
 * above is a gap, never a divider.
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
 * That predicate is exported as `hasPaidStateContent` so `WeekMoneyCard` can
 * decide whether it has a card to draw at all without re-deriving it.
 *
 * `payments` is the ledger the server returned. The section never re-derives
 * its total from anything other than `paidState`, which is itself derived once
 * in `utils/paidState`. The only re-ordering it does is D-20's grouping below.
 *
 * CORRECTIONS (D-20, attention spec §4.1) render as a row DIRECTLY UNDER the
 * payment they reverse, indented one step, with the original row unchanged and
 * keeping its full amount forever. The figure is negative, tabular, and the
 * SAME size and colour as the row above it: it is a legitimate entry in a
 * ledger, and colouring it destructive or badging it tells the reader
 * something went wrong with the APP. The required reason renders on the row —
 * it is the only thing that makes a reversal readable a year later.
 */
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import { ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { spacing } from '@/lib/design-tokens/spacing';
import { Icon } from '@/lib/icons/iconWithClassName';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { H4, Small } from '@/src/components/ui/typography';
import { AmountRow } from '@/src/domains/pay/components/AmountRow';
import { formatMoney } from '@/src/lib/money';
import { formatEarningsLongDate } from '../utils/earningsFormat';
import type { PaidStatus, WeekPaidState } from '../utils/paidState';
import { CHEVRON_SLOT } from './TimeEntryRow';

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

/** Is there any settlement to state at all? See module header. */
export function hasPaidStateContent(
  paidState: WeekPaidState | null,
  payments: Payment[]
): boolean {
  if (!paidState) return false;
  return paidState.grossMinor !== 0 || payments.length > 0;
}

/**
 * Each correction placed directly after the payment it corrects, with the
 * week's own oldest-first payment order otherwise untouched (D-20).
 *
 * A correction whose original is NOT in this list cannot happen inside one
 * week's ledger — but it is appended at the end rather than dropped anyway,
 * because a money row silently disappearing is the worst failure this
 * component has.
 */
function groupCorrectionsUnderOriginals(payments: Payment[]): Payment[] {
  const correctionsFor = new Map<string, Payment[]>();
  for (const payment of payments) {
    if (payment.kind !== 'correction' || payment.corrects_payment_id === null) {
      continue;
    }
    const siblings = correctionsFor.get(payment.corrects_payment_id);
    if (siblings) {
      siblings.push(payment);
    } else {
      correctionsFor.set(payment.corrects_payment_id, [payment]);
    }
  }

  const ordered: Payment[] = [];
  const placed = new Set<string>();
  for (const payment of payments) {
    if (payment.kind === 'correction') continue;
    ordered.push(payment);
    for (const correction of correctionsFor.get(payment.id) ?? []) {
      ordered.push(correction);
      placed.add(correction.id);
    }
  }
  for (const payment of payments) {
    if (payment.kind === 'correction' && !placed.has(payment.id)) {
      ordered.push(payment);
    }
  }
  return ordered;
}

interface PaidStateSectionProps {
  /** `null` when the week has no server gross — the section then renders
   * nothing at all. Never default this with `?? 0` at a call site. */
  paidState: WeekPaidState | null;
  payments: Payment[];
  currency: string;
  /** Supplied by the PARENT view only. Its absence is what makes this
   * read-only for the carer and for a read-only helper. */
  onMarkPaidPress?: () => void;
  /** Held down while a record-payment request is in flight. */
  isMarkPaidDisabled?: boolean;
  /** Opens the payment's own detail. Its absence leaves the ledger exactly
   * as it was — a chevron with no destination is a lie, so the slot is not
   * even reserved. Every line in the block is pressable, or none is. */
  onPaymentPress?: (payment: Payment) => void;
  testID?: string;
}

export function PaidStateSection({
  paidState,
  payments,
  currency,
  onMarkPaidPress,
  isMarkPaidDisabled = false,
  onPaymentPress,
  testID = 'hours-paid-state',
}: PaidStateSectionProps) {
  const { t } = useTranslation('hours');

  if (!hasPaidStateContent(paidState, payments) || !paidState) return null;

  const { status, paidMinor, balanceMinor } = paidState;
  const ledger = groupCorrectionsUnderOriginals(payments);
  // Nothing left to record — offering the action would only produce a
  // refusal the server has to write the copy for.
  const canMarkPaid = onMarkPaidPress !== undefined && balanceMinor > 0;

  return (
    <View testID={testID} className="gap-3">
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
          {ledger.map(payment => {
            const isCorrection = payment.kind === 'correction';
            // The payment's OWN currency, not the section's: this line and
            // the detail sheet it opens are one tap apart, and two spellings
            // of one figure is a trust bug. The rows above stay week-scoped.
            // Keyed here, not only on the wrapper: the unpressable branch
            // returns this element as the list item itself.
            //
            // A correction's figure is ALREADY negative on the wire, so the
            // minus sign comes from the data through the one money formatter
            // — never from a sign this component adds. Same `AmountRow`,
            // same size, same colour as the row it corrects (see the module
            // doc for why it is not red).
            const line = (
              <AmountRow
                key={payment.id}
                testID={`${testID}-line-${payment.id}`}
                label={
                  isCorrection
                    ? t('paid.correctionRow', {
                        date: formatEarningsLongDate(payment.paid_at),
                      })
                    : formatEarningsLongDate(payment.paid_at)
                }
                value={formatMoney(payment.amount_minor, payment.currency)}
                subLine={
                  (isCorrection
                    ? payment.correction_reason
                    : payment.method_note) ?? undefined
                }
              />
            );
            // `-open` on the wrapper, not the base testID: `AmountRow`
            // derives its money target as `${testID}-value` and moving the
            // base would silently rename a money assertion.
            const row = onPaymentPress ? (
              <Pressable
                key={payment.id}
                testID={`${testID}-line-${payment.id}-open`}
                accessibilityRole="button"
                onPress={() => onPaymentPress(payment)}
                className="flex-row items-center gap-3"
                style={{ minHeight: spacing.minTouchTarget }}
              >
                <View className="min-w-0 flex-1">{line}</View>
                <View style={{ width: CHEVRON_SLOT }}>
                  <Icon
                    icon={ChevronRight}
                    size={CHEVRON_SLOT}
                    className="text-muted-foreground"
                  />
                </View>
              </Pressable>
            ) : (
              line
            );
            // One step of indent, and nothing else: the indent IS the
            // statement that this row belongs to the one above it.
            return isCorrection ? (
              <View
                key={payment.id}
                testID={`${testID}-correction-${payment.id}`}
                style={{ paddingLeft: spacing.md }}
              >
                {row}
              </View>
            ) : (
              row
            );
          })}
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
    </View>
  );
}

export type { PaidStateSectionProps };
