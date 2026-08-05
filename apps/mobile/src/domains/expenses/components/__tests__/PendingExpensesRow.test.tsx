/**
 * @module domains/expenses/components/__tests__/PendingExpensesRow.test
 * TIER0-CX-SPEC.md §6.2: "In ParentWeekView's ListFooterComponent, above the
 * approve actions, when pending expenses exist for the week: a
 * `rounded-row bg-card` + `elevation.row` pressable, 'N expenses to review
 * · £34.80', chevron." Renders nothing when there are no pending expenses.
 * Owner ruling: never shows an indicative money figure derived from pending
 * mileage — the count·amount label only sums EXPENSE-kind pending rows'
 * `amount_minor` (which is always present), not mileage's null amount.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Expense } from '@steadily-nanny/shared-types/schemas/expense.schema';
import { fireEvent, render } from '@testing-library/react-native';

let PendingExpensesRow: typeof import('../PendingExpensesRow').PendingExpensesRow;

beforeAll(async () => {
  PendingExpensesRow = (await import('../PendingExpensesRow'))
    .PendingExpensesRow;
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

describe('PendingExpensesRow', () => {
  it('renders nothing when there are no pending expenses', () => {
    const { queryByTestId } = render(
      <PendingExpensesRow
        testID="expenses-pending-row"
        pendingExpenses={[]}
        currency="GBP"
        onPress={() => {}}
      />
    );
    expect(queryByTestId('expenses-pending-row')).toBeNull();
  });

  it('renders the row and calls onPress', () => {
    const onPress = mock(() => {});
    const { getByTestId } = render(
      <PendingExpensesRow
        testID="expenses-pending-row"
        pendingExpenses={[makeExpense()]}
        currency="GBP"
        onPress={onPress}
      />
    );

    const row = getByTestId('expenses-pending-row');
    expect(row).toBeTruthy();
    fireEvent.press(row);
    expect(onPress).toHaveBeenCalled();
  });

  it('sums only expense-kind amounts, not pending mileage (no amount yet)', () => {
    const { getByTestId } = render(
      <PendingExpensesRow
        testID="expenses-pending-row"
        pendingExpenses={[
          makeExpense({ id: 'expense-1', amount_minor: 1200 }),
          makeExpense({
            id: 'expense-2',
            kind: 'mileage',
            amount_minor: null,
            miles: 12.4,
          }),
        ]}
        currency="GBP"
        onPress={() => {}}
      />
    );

    expect(getByTestId('expenses-pending-row-amount').props.children).toBe(
      '£12.00'
    );
  });
});
