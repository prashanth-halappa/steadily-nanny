/**
 * @module domains/expenses/components/__tests__/PendingExpensesRow.test
 * TIER0-CX-SPEC.md §6.2: "In ParentWeekView's ListFooterComponent, above the
 * approve actions, when pending expenses exist for the week: a
 * `rounded-row bg-card` + `elevation.row` pressable, 'N expenses to review
 * · £34.80', chevron." Renders nothing when there are no pending expenses.
 * Owner ruling: never shows an indicative money figure derived from pending
 * mileage — the count·amount label only sums EXPENSE-kind pending rows'
 * `amount_minor` (which is always present), not mileage's null amount.
 *
 * Phase 3+4 adversarial review, finding 12: an ALL-mileage pending set
 * summed `amount_minor ?? 0` to a fabricated "£0.00" for claims that will
 * definitely pay out — the fix withholds the money total whenever there is
 * nothing priced (or the priced rows span more than one currency — this
 * list is HOUSEHOLD-WIDE, not week-scoped, so a currency change can put
 * different currencies in the same queue) and shows a count/mileage note
 * instead.
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
        onPress={() => {}}
      />
    );

    expect(getByTestId('expenses-pending-row-amount').props.children).toBe(
      '£12.00'
    );
    // A note about the one still-unpriced mileage claim, not a silent drop.
    expect(getByTestId('expenses-pending-row-mileage-note')).toBeTruthy();
  });

  // finding 12's headline defect.
  it('ALL-mileage pending set: NO money total at all, never a fabricated "£0.00"', () => {
    const { getByTestId, queryByTestId, queryAllByText } = render(
      <PendingExpensesRow
        testID="expenses-pending-row"
        pendingExpenses={[
          makeExpense({
            id: 'expense-1',
            kind: 'mileage',
            amount_minor: null,
            miles: 12.4,
          }),
          makeExpense({
            id: 'expense-2',
            kind: 'mileage',
            amount_minor: null,
            miles: 8.0,
          }),
        ]}
        onPress={() => {}}
      />
    );

    expect(queryByTestId('expenses-pending-row-amount')).toBeNull();
    expect(getByTestId('expenses-pending-row-mileage-note')).toBeTruthy();
    expect(queryAllByText('£0.00')).toHaveLength(0);
  });

  it('mixed-currency priced rows: suppresses the total rather than mislabelling it', () => {
    const { queryByTestId, getByTestId } = render(
      <PendingExpensesRow
        testID="expenses-pending-row"
        pendingExpenses={[
          makeExpense({
            id: 'expense-gbp',
            amount_minor: 1200,
            currency: 'GBP',
          }),
          makeExpense({
            id: 'expense-eur',
            amount_minor: 1500,
            currency: 'EUR',
          }),
        ]}
        onPress={() => {}}
      />
    );

    expect(queryByTestId('expenses-pending-row-amount')).toBeNull();
    expect(
      getByTestId('expenses-pending-row-mixed-currency-note')
    ).toBeTruthy();
  });

  it('every row priced, single currency: shows the total, no notes', () => {
    const { getByTestId, queryByTestId } = render(
      <PendingExpensesRow
        testID="expenses-pending-row"
        pendingExpenses={[
          makeExpense({ id: 'expense-1', amount_minor: 1200 }),
          makeExpense({ id: 'expense-2', amount_minor: 2200 }),
        ]}
        onPress={() => {}}
      />
    );

    expect(getByTestId('expenses-pending-row-amount').props.children).toBe(
      '£34.00'
    );
    expect(queryByTestId('expenses-pending-row-mileage-note')).toBeNull();
    expect(
      queryByTestId('expenses-pending-row-mixed-currency-note')
    ).toBeNull();
  });
});
