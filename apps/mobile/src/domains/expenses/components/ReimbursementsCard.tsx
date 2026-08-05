/**
 * @module domains/expenses/components/ReimbursementsCard
 *
 * The weekly statement's Reimbursements section (TIER0-CX-SPEC.md §6.3/§7):
 * a card of its own, after the day rows and before actions, in BOTH role
 * views — visually and semantically separate from wages
 * (docs/11-MONEY.md §6). Not rendered at all when the week has no approved
 * expenses (§6.3 "Empty (no expenses this week): the card is not rendered
 * at all").
 *
 * `totalMinor` is the server-computed `earnings.reimbursements_minor` —
 * this component never re-derives the subtotal by summing
 * `approvedExpenses` itself, same "trust the server's total, render
 * verbatim" discipline `EarningsBreakdownSheet` already documents for
 * `gross_minor`.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { H4, Small } from '@/src/components/ui/typography';
import { AmountRow } from '@/src/domains/pay/components/AmountRow';
import { formatEarningsSpanDate } from '@/src/domains/timesheet/utils/earningsFormat';
import { formatMoney } from '@/src/lib/money';
import type { Expense } from '../types';

interface ReimbursementsCardProps {
  /** Approved expenses/mileage for the week ONLY — the caller filters;
   * a rejected or still-pending row must never reach this component (§8:
   * rejected rows are excluded from the subtotal). */
  approvedExpenses: Expense[];
  /** `earnings.reimbursements_minor` — the frozen/live server total. */
  totalMinor: number;
  currency: string;
  testID?: string;
}

export function ReimbursementsCard({
  approvedExpenses,
  totalMinor,
  currency,
  testID = 'reimbursements-card',
}: ReimbursementsCardProps) {
  const { t } = useTranslation('expenses');

  if (approvedExpenses.length === 0) return null;

  return (
    <View testID={testID} className="mt-4 gap-3 rounded-cell bg-card p-4">
      <H4>{t('reimbursements.title')}</H4>

      <View className="gap-3">
        {approvedExpenses.map(expense => (
          <AmountRow
            key={expense.id}
            testID={`${testID}-line-${expense.id}`}
            label={expense.description}
            value={
              expense.amount_minor !== null
                ? formatMoney(expense.amount_minor, currency)
                : null
            }
            subLine={formatEarningsSpanDate(expense.local_date)}
          />
        ))}
      </View>

      <View className="flex-row items-baseline justify-between gap-3 rounded-cell bg-muted px-4 py-3">
        <H4>{t('reimbursements.totalLabel')}</H4>
        <H4 testID={`${testID}-total`} tabular>
          {formatMoney(totalMinor, currency)}
        </H4>
      </View>

      <Small testID={`${testID}-note`} className="text-muted-foreground">
        {t('reimbursements.note')}
      </Small>
    </View>
  );
}

export type { ReimbursementsCardProps };
