/**
 * @module domains/expenses/components/ExpensesListCard
 *
 * The nanny's own "Expenses" footer card (TIER0-CX-SPEC.md §6.1): every
 * claim in the week, every status — distinct from the statement's
 * Reimbursements card (§6.3/§7), which is approved-only and shared by both
 * roles. Renders nothing at all when the week has no claims (same
 * empty-state discipline as the Reimbursements card).
 */
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/src/components/ui/card';
import { H4 } from '@/src/components/ui/typography';
import type { Expense } from '../types';
import { ExpenseRow } from './ExpenseRow';

interface ExpensesListCardProps {
  expenses: Expense[];
  onEdit?: (expense: Expense) => void;
  onWithdraw?: (expenseId: string) => void;
  testID?: string;
}

export function ExpensesListCard({
  expenses,
  onEdit,
  onWithdraw,
  testID = 'expenses-list',
}: ExpensesListCardProps) {
  const { t } = useTranslation('expenses');

  if (expenses.length === 0) return null;

  return (
    <Card testID={testID} className="mt-4">
      <CardContent className="gap-2">
        <H4>{t('list.title')}</H4>
        {expenses.map(expense => (
          <ExpenseRow
            key={expense.id}
            testID={`expense-row-${expense.id}`}
            expense={expense}
            onEdit={onEdit}
            onWithdraw={onWithdraw}
          />
        ))}
      </CardContent>
    </Card>
  );
}

export type { ExpensesListCardProps };
