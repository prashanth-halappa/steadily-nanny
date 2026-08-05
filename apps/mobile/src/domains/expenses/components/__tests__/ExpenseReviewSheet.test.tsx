/**
 * @module domains/expenses/components/__tests__/ExpenseReviewSheet.test
 * D15 real-render — TIER0-CX-SPEC.md §6.2: one card per pending item,
 * Approve/Not-this-one, the reveal-a-note-then-Send reject flow, and the
 * owner ruling that pending mileage NEVER shows a computed amount (miles
 * only) even though the spec's own worked example shows an arrow-to-money.
 * Also covers the no-mileage-rate typed-error arm's inline copy + "Set a
 * rate" affordance.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Expense } from '@steadily-nanny/shared-types/schemas/expense.schema';
import { fireEvent, render } from '@testing-library/react-native';

mock.module('@/src/components/custom/BottomSheetBase', () => {
  const R = require('react');
  return {
    BottomSheetBase: ({
      visible,
      children,
      testID,
    }: {
      visible: boolean;
      children: React.ReactNode;
      testID?: string;
    }) => (visible ? R.createElement('View', { testID }, children) : null),
  };
});

let ExpenseReviewSheet: typeof import('../ExpenseReviewSheet').ExpenseReviewSheet;

beforeAll(async () => {
  ExpenseReviewSheet = (await import('../ExpenseReviewSheet'))
    .ExpenseReviewSheet;
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

describe('ExpenseReviewSheet', () => {
  it('renders one card per pending expense with a money amount', () => {
    const { getByTestId } = render(
      <ExpenseReviewSheet
        visible
        onDismiss={() => {}}
        expenses={[makeExpense()]}
        onApprove={() => {}}
        onReject={() => {}}
      />
    );

    expect(
      getByTestId('expense-review-card-expense-1-amount').props.children
    ).toBe('£12.00');
  });

  it('pending mileage shows MILES ONLY — never a computed money amount', () => {
    const { getByTestId } = render(
      <ExpenseReviewSheet
        visible
        onDismiss={() => {}}
        expenses={[
          makeExpense({
            kind: 'mileage',
            amount_minor: null,
            miles: 12.4,
          }),
        ]}
        onApprove={() => {}}
        onReject={() => {}}
      />
    );

    const amount = getByTestId('expense-review-card-expense-1-amount').props
      .children;
    // Key-echoed under the global test i18n mock (ignores interpolation) —
    // the load-bearing assertion is that this is NOT a money string.
    expect(amount).toBe('reviewSheet.milesValue');
    expect(amount).not.toContain('£');
  });

  it('calls onApprove with the expense id', () => {
    const onApprove = mock(() => {});
    const { getByTestId } = render(
      <ExpenseReviewSheet
        visible
        onDismiss={() => {}}
        expenses={[makeExpense()]}
        onApprove={onApprove}
        onReject={() => {}}
      />
    );

    fireEvent.press(getByTestId('expense-review-card-expense-1-approve'));
    expect(onApprove).toHaveBeenCalledWith('expense-1');
  });

  it('"Not this one" reveals a note field, then Send calls onReject with the trimmed note', () => {
    const onReject = mock(() => {});
    const { getByTestId, queryByTestId } = render(
      <ExpenseReviewSheet
        visible
        onDismiss={() => {}}
        expenses={[makeExpense()]}
        onApprove={() => {}}
        onReject={onReject}
      />
    );

    expect(
      queryByTestId('expense-review-card-expense-1-note-input')
    ).toBeNull();

    fireEvent.press(getByTestId('expense-review-card-expense-1-reject'));
    expect(
      getByTestId('expense-review-card-expense-1-note-input')
    ).toBeTruthy();

    fireEvent.changeText(
      getByTestId('expense-review-card-expense-1-note-input'),
      '  Already paid in cash  '
    );
    fireEvent.press(getByTestId('expense-review-card-expense-1-send'));

    expect(onReject).toHaveBeenCalledWith('expense-1', 'Already paid in cash');
  });

  it('the note is optional — Send with an empty note still calls onReject', () => {
    const onReject = mock(() => {});
    const { getByTestId } = render(
      <ExpenseReviewSheet
        visible
        onDismiss={() => {}}
        expenses={[makeExpense()]}
        onApprove={() => {}}
        onReject={onReject}
      />
    );

    fireEvent.press(getByTestId('expense-review-card-expense-1-reject'));
    fireEvent.press(getByTestId('expense-review-card-expense-1-send'));

    expect(onReject).toHaveBeenCalledWith('expense-1', '');
  });

  it('shows the no-mileage-rate inline error + Set a rate affordance for the errored row only', () => {
    const onSetRatePress = mock(() => {});
    const { getByTestId, queryByTestId } = render(
      <ExpenseReviewSheet
        visible
        onDismiss={() => {}}
        expenses={[
          makeExpense({ id: 'expense-1' }),
          makeExpense({ id: 'expense-2', description: 'Nursery run' }),
        ]}
        onApprove={() => {}}
        onReject={() => {}}
        mileageRateErrorId="expense-1"
        onSetRatePress={onSetRatePress}
      />
    );

    expect(
      getByTestId('expense-review-card-expense-1-mileage-error')
    ).toBeTruthy();
    expect(
      queryByTestId('expense-review-card-expense-2-mileage-error')
    ).toBeNull();

    fireEvent.press(getByTestId('expense-review-card-expense-1-set-rate'));
    expect(onSetRatePress).toHaveBeenCalled();
  });

  it('disables the submitting row only, not other rows', () => {
    const { getByTestId } = render(
      <ExpenseReviewSheet
        visible
        onDismiss={() => {}}
        expenses={[
          makeExpense({ id: 'expense-1' }),
          makeExpense({ id: 'expense-2', description: 'Nursery run' }),
        ]}
        onApprove={() => {}}
        onReject={() => {}}
        submittingId="expense-1"
      />
    );

    expect(
      getByTestId('expense-review-card-expense-1-approve').props.disabled
    ).toBe(true);
    expect(
      getByTestId('expense-review-card-expense-2-approve').props.disabled
    ).toBe(false);
  });
});
