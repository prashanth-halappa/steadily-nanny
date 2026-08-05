/**
 * @module domains/expenses/components/__tests__/ExpensesListCard.test
 * TIER0-CX-SPEC.md §6.1: "List: an ExpenseRow per item in the same week, in
 * a footer card titled 'Expenses'." Renders nothing when the week has no
 * expenses at all (same "card not rendered when empty" discipline as the
 * Reimbursements card, §6.3).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import type { Expense } from '@steadily-nanny/shared-types/schemas/expense.schema';
import { render } from '@testing-library/react-native';

let ExpensesListCard: typeof import('../ExpensesListCard').ExpensesListCard;

beforeAll(async () => {
  ExpensesListCard = (await import('../ExpensesListCard')).ExpensesListCard;
});

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'expense-1',
    household_id: 'household-1',
    carer_id: 'nanny-1',
    local_date: '2026-08-03',
    kind: 'expense',
    description: 'Soft play tickets',
    amount_minor: 1200,
    miles: null,
    currency: 'GBP',
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    carer_display_name: 'Amara',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ExpensesListCard', () => {
  it('renders nothing when there are no expenses', () => {
    const { queryByTestId } = render(
      <ExpensesListCard testID="expenses-list" expenses={[]} />
    );
    expect(queryByTestId('expenses-list')).toBeNull();
  });

  it('renders a row per expense, in a titled card', () => {
    const { getByTestId } = render(
      <ExpensesListCard
        testID="expenses-list"
        expenses={[
          makeExpense({ id: 'expense-1' }),
          makeExpense({ id: 'expense-2', description: 'Nursery run' }),
        ]}
      />
    );

    expect(getByTestId('expenses-list')).toBeTruthy();
    expect(
      getByTestId('expense-row-expense-1-description').props.children
    ).toBe('Soft play tickets');
    expect(
      getByTestId('expense-row-expense-2-description').props.children
    ).toBe('Nursery run');
  });
});
