/**
 * @module domains/expenses/components/__tests__/ExpensesListCard.test
 * TIER0-CX-SPEC.md §6.1: "List: an ExpenseRow per item in the same week, in
 * a footer card titled 'Expenses'." Renders nothing when the week has no
 * expenses AND no add-expense handler — the empty-state discipline the
 * Reimbursements card also follows, except this card is now also the "Add
 * an expense" entry point (Daylight P1), so an empty week with a handler
 * still renders (just the button).
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
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
  it('renders nothing when there are no expenses and no onAddExpense handler (readOnly / past-member)', () => {
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

  // Daylight P1: two full-weight white cards (this one and Reimbursements)
  // stacked on one subject competed for attention. This one drops to T4 —
  // the working list, supporting material to the money statement.
  describe('T4 tiering', () => {
    it('sits on a bg-muted ground, not bg-card', () => {
      const { getByTestId } = render(
        <ExpensesListCard testID="expenses-list" expenses={[makeExpense()]} />
      );

      const card = getByTestId('expenses-list');
      expect(card.props.className).toContain('bg-muted');
      expect(card.props.className).not.toContain('bg-card');
    });

    it('carries no elevation style (T4 has none)', () => {
      const { getByTestId } = render(
        <ExpensesListCard testID="expenses-list" expenses={[makeExpense()]} />
      );

      expect(getByTestId('expenses-list').props.style).toBeUndefined();
    });
  });

  // Daylight P1: "Add an expense" used to float on a bare `mt-4` between
  // this card and ReimbursementsCard, belonging to neither. It's now this
  // card's own footer action.
  describe('onAddExpense footer action', () => {
    it('still renders (just the button) with zero expenses, when onAddExpense is supplied', () => {
      const onAddExpense = mock(() => {});
      const { getByTestId } = render(
        <ExpensesListCard
          testID="expenses-list"
          expenses={[]}
          onAddExpense={onAddExpense}
        />
      );

      expect(getByTestId('expenses-list')).toBeTruthy();
      const button = getByTestId('expenses-add');
      button.props.onPress?.();
      expect(onAddExpense).toHaveBeenCalledTimes(1);
    });

    it('renders the button inside the card alongside existing rows', () => {
      const { getByTestId } = render(
        <ExpensesListCard
          testID="expenses-list"
          expenses={[makeExpense()]}
          onAddExpense={() => {}}
        />
      );

      expect(getByTestId('expense-row-expense-1-description')).toBeTruthy();
      expect(getByTestId('expenses-add')).toBeTruthy();
    });

    it('omits the button when onAddExpense is not supplied (readOnly / past-member)', () => {
      const { queryByTestId } = render(
        <ExpensesListCard testID="expenses-list" expenses={[makeExpense()]} />
      );

      expect(queryByTestId('expenses-add')).toBeNull();
    });
  });
});
