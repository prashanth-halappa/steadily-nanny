/**
 * @module domains/expenses/components/ExpensesListCard
 *
 * The nanny's own "Expenses" footer card (TIER0-CX-SPEC.md §6.1): every
 * claim in the week, every status — distinct from the statement's
 * Reimbursements card (§6.3/§7), which is approved-only and shared by both
 * roles.
 *
 * Daylight P1 tiering: two full-weight white cards stacked directly on one
 * subject competed for attention (a screenshot regression). This one is the
 * working list — supporting material next to Reimbursements' money
 * statement — so it drops to T4: `bg-muted`, no elevation, title down to
 * `MetadataLabel`. T4 is not a `Card` tone (`Card`'s `default` tone still
 * carries `elevation.card`), so this renders a plain `View` rather than
 * `Card`; `CardContent` is still reused for its padding + `text-card-foreground`
 * context, which resolves to the same ink on `bg-muted` as it does on `bg-card`.
 *
 * `onAddExpense` (Daylight P1): "Add an expense" used to float on a bare
 * `mt-4` between this card and `ReimbursementsCard`, belonging to neither —
 * it's now this card's own footer action. Because that button is the only
 * way to log a FIRST claim, the old "render nothing when empty" rule now
 * only holds when there is also no handler (`readOnly` / past-member, same
 * gate `onEdit`/`onWithdraw` already use) — an empty week with a handler
 * still renders, showing just the button.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { CardContent } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { MetadataLabel } from '@/src/components/ui/typography';
import type { Expense } from '../types';
import { ExpenseRow } from './ExpenseRow';

interface ExpensesListCardProps {
  expenses: Expense[];
  onEdit?: (expense: Expense) => void;
  onWithdraw?: (expenseId: string) => void;
  /** Omit to render no button at all (readOnly / past-member) — same gate
   * `onEdit`/`onWithdraw` already apply. */
  onAddExpense?: () => void;
  testID?: string;
}

export function ExpensesListCard({
  expenses,
  onEdit,
  onWithdraw,
  onAddExpense,
  testID = 'expenses-list',
}: ExpensesListCardProps) {
  const { t } = useTranslation('expenses');

  if (expenses.length === 0 && !onAddExpense) return null;

  return (
    <View testID={testID} className="mt-4 rounded-card bg-muted">
      <CardContent className="gap-2">
        <MetadataLabel>{t('list.title')}</MetadataLabel>
        {expenses.map(expense => (
          <ExpenseRow
            key={expense.id}
            testID={`expense-row-${expense.id}`}
            expense={expense}
            onEdit={onEdit}
            onWithdraw={onWithdraw}
          />
        ))}
        {onAddExpense ? (
          <Button
            testID="expenses-add"
            variant="outline"
            className="mt-2"
            onPress={onAddExpense}
          >
            <Text className="text-foreground">{t('addButton')}</Text>
          </Button>
        ) : null}
      </CardContent>
    </View>
  );
}

export type { ExpensesListCardProps };
