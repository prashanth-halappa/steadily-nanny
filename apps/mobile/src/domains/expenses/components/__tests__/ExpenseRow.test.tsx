/**
 * @module domains/expenses/components/__tests__/ExpenseRow.test
 * TIER0-CX-SPEC.md §6.1's list row + §8's rejected-row rules: a rejected
 * row shows the parent's note and is excluded from totals (enforced by the
 * CALLER's sum, not this component — but its pill must never read
 * "Approved"); pending rows are editable/withdrawable, reviewed rows are
 * not; pending mileage with no rate shows "N.N miles", never a money
 * figure or an indicative amount.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Expense } from '@steadily-nanny/shared-types/schemas/expense.schema';
import { fireEvent, render } from '@testing-library/react-native';

let ExpenseRow: typeof import('../ExpenseRow').ExpenseRow;

beforeAll(async () => {
  ExpenseRow = (await import('../ExpenseRow')).ExpenseRow;
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

describe('ExpenseRow', () => {
  it('renders an expense-kind amount and the description', () => {
    const { getByTestId } = render(
      <ExpenseRow testID="expense-row-1" expense={makeExpense()} />
    );

    expect(getByTestId('expense-row-1-description').props.children).toBe(
      'Soft play tickets'
    );
    expect(getByTestId('expense-row-1-amount').props.children).toBe('£12.00');
  });

  it('renders a pending status pill', () => {
    const { getByTestId } = render(
      <ExpenseRow testID="expense-row-1" expense={makeExpense()} />
    );
    expect(getByTestId('expense-row-1-status')).toBeTruthy();
  });

  it('renders an approved status pill and no edit/withdraw controls', () => {
    const { getByTestId, queryByTestId } = render(
      <ExpenseRow
        testID="expense-row-1"
        expense={makeExpense({ status: 'approved' })}
      />
    );
    expect(getByTestId('expense-row-1-status')).toBeTruthy();
    expect(queryByTestId('expense-row-1-edit')).toBeNull();
    expect(queryByTestId('expense-row-1-withdraw')).toBeNull();
  });

  it('shows the rejection note for a declined row, and no edit/withdraw controls', () => {
    const { getByTestId, queryByTestId } = render(
      <ExpenseRow
        testID="expense-row-1"
        expense={makeExpense({
          status: 'rejected',
          review_note: 'Already paid in cash',
        })}
      />
    );
    // Global test preload key-echoes `t()` (ignores interpolation args) —
    // asserting the stable KEY, not localized copy, per house convention
    // (see `EarningsBreakdownSheet.test.tsx`).
    expect(getByTestId('expense-row-1-rejected-note').props.children).toBe(
      'list.rejectedNote'
    );
    expect(queryByTestId('expense-row-1-edit')).toBeNull();
    expect(queryByTestId('expense-row-1-withdraw')).toBeNull();
  });

  it('pending rows show edit + withdraw controls, and call the handlers', () => {
    const onEdit = mock(() => {});
    const onWithdraw = mock(() => {});
    const expense = makeExpense();
    const { getByTestId } = render(
      <ExpenseRow
        testID="expense-row-1"
        expense={expense}
        onEdit={onEdit}
        onWithdraw={onWithdraw}
      />
    );

    fireEvent.press(getByTestId('expense-row-1-edit'));
    expect(onEdit).toHaveBeenCalledWith(expense);

    fireEvent.press(getByTestId('expense-row-1-withdraw'));
    expect(onWithdraw).toHaveBeenCalledWith(expense.id);
  });

  it('does not outrank the benign Edit action with destructive weight — Withdraw is muted, not red, until the confirm dialog', () => {
    const expense = makeExpense();
    const { getByText } = render(
      <ExpenseRow testID="expense-row-1" expense={expense} />
    );

    const withdrawLabel = getByText('list.withdrawButton');
    expect(withdrawLabel.props.className).toContain('text-muted-foreground');
    expect(withdrawLabel.props.className).not.toContain('text-destructive');
  });

  it('pending mileage with no frozen amount renders miles, never a money figure', () => {
    const { getByTestId } = render(
      <ExpenseRow
        testID="expense-row-1"
        expense={makeExpense({
          kind: 'mileage',
          amount_minor: null,
          miles: 12.4,
        })}
      />
    );
    // Key-echoed (see note above) — the load-bearing assertion is that this
    // is NOT a money string (`formatMoney` is real, `t()` is mocked).
    expect(getByTestId('expense-row-1-amount').props.children).toBe(
      'list.milesValue'
    );
    expect(getByTestId('expense-row-1-amount').props.children).not.toContain(
      '£'
    );
  });

  it('approved mileage renders the frozen money amount', () => {
    const { getByTestId } = render(
      <ExpenseRow
        testID="expense-row-1"
        expense={makeExpense({
          kind: 'mileage',
          status: 'approved',
          amount_minor: 558,
          miles: 12.4,
        })}
      />
    );
    expect(getByTestId('expense-row-1-amount').props.children).toBe('£5.58');
  });
});
