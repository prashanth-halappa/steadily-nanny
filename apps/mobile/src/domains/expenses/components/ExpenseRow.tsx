/**
 * @module domains/expenses/components/ExpenseRow
 *
 * One row in the nanny's own "Expenses" list (TIER0-CX-SPEC.md §6.1):
 * description + amount (or "N.N miles" while pending mileage has no frozen
 * amount yet) + a `StatusPill`. §8's rejected-row rule: the row stays
 * visible with the parent's note beneath, excluded from any total the
 * CALLER computes (this component never sums), and not re-submittable —
 * there is no edit/withdraw control on a reviewed row, only on a still-
 * `pending` one.
 *
 * Pending MILEAGE never shows a computed amount, even indicatively — the
 * amount is frozen server-side at approval (owner ruling, same as the
 * parent's review sheet). `amount_minor` is `null` on every pending
 * mileage row by DB constraint (migration 044's third CHECK), so this
 * component only ever has real money to show once it isn't `null`.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Text } from '@/src/components/ui/text';
import { Body, Small } from '@/src/components/ui/typography';
import { formatMoney } from '@/src/lib/money';
import type { Expense } from '../types';

interface ExpenseRowProps {
  expense: Expense;
  onEdit?: (expense: Expense) => void;
  onWithdraw?: (expenseId: string) => void;
  testID?: string;
}

function pillVariant(
  status: Expense['status']
): 'pending' | 'confirmed' | 'declined' {
  if (status === 'approved') return 'confirmed';
  if (status === 'rejected') return 'declined';
  return 'pending';
}

export function ExpenseRow({
  expense,
  onEdit,
  onWithdraw,
  testID = 'expense-row',
}: ExpenseRowProps) {
  const { t } = useTranslation('expenses');

  const amountLabel =
    expense.amount_minor !== null
      ? formatMoney(expense.amount_minor, expense.currency)
      : expense.miles !== null
        ? t('list.milesValue', { miles: expense.miles })
        : '';

  const statusLabel =
    expense.status === 'approved'
      ? t('list.statusApproved')
      : expense.status === 'rejected'
        ? t('list.statusRejected')
        : t('list.statusPending');

  const isPending = expense.status === 'pending';

  return (
    <View testID={testID} className="gap-1 py-2">
      <View className="flex-row items-start justify-between gap-3">
        <Body testID={`${testID}-description`} className="flex-1">
          {expense.description}
        </Body>
        <Body
          testID={`${testID}-amount`}
          className="flex-shrink-0 font-medium"
          tabular
        >
          {amountLabel}
        </Body>
      </View>
      <StatusPill
        testID={`${testID}-status`}
        variant={pillVariant(expense.status)}
        label={statusLabel}
      />
      {expense.status === 'rejected' && expense.review_note ? (
        <Small
          testID={`${testID}-rejected-note`}
          className="text-muted-foreground"
        >
          {t('list.rejectedNote', { note: expense.review_note })}
        </Small>
      ) : null}
      {isPending ? (
        <View className="mt-1 flex-row gap-2">
          <Button
            testID={`${testID}-edit`}
            variant="ghost"
            size="sm"
            onPress={() => onEdit?.(expense)}
          >
            <Text className="text-foreground">{t('list.editButton')}</Text>
          </Button>
          <Button
            testID={`${testID}-withdraw`}
            variant="ghost"
            size="sm"
            onPress={() => onWithdraw?.(expense.id)}
          >
            <Text className="text-destructive">{t('list.withdrawButton')}</Text>
          </Button>
        </View>
      ) : null}
    </View>
  );
}

export type { ExpenseRowProps };
