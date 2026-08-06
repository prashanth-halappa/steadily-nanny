/**
 * @module domains/expenses/components/__tests__/ExpenseAddSheet.test
 * D15 real-render — renders the ACTUAL `ExpenseAddSheet`, mocking only
 * `ExpenseDateField` (native-picker boundary, see that file's own doc
 * comment) and `BottomSheetBase` (Modal-in-test-renderer noise). Covers:
 * kind toggle switches which field renders, amount vs miles validation
 * (including the >1-decimal miles refusal — the wire schema would reject
 * it too, this is the client-side mirror), a mileage payload never carries
 * `amount_minor`, the no-rate hint arm, and edit-mode seeding.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
import type { CreateExpenseRequest } from '@steadily-nanny/shared-types/schemas/expense.schema';
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

mock.module('@/src/domains/expenses/components/ExpenseDateField', () => {
  const R = require('react');
  return {
    ExpenseDateField: ({
      value,
      onChange,
      testID,
    }: {
      value: string;
      onChange: (value: string) => void;
      testID?: string;
    }) =>
      R.createElement('TouchableOpacity', {
        testID: testID ?? 'expense-date-field',
        accessibilityLabel: value,
        onPress: () => onChange('2026-08-04'),
      }),
  };
});

let ExpenseAddSheet: typeof import('../ExpenseAddSheet').ExpenseAddSheet;

beforeAll(async () => {
  ExpenseAddSheet = (await import('../ExpenseAddSheet')).ExpenseAddSheet;

  // Freeze the clock inside `DEFAULT_PROPS.todayISO`'s UTC calendar day.
  // `handleSubmit` recomputes "today" live via `localDateInZone` (so a sheet
  // left open across midnight submits the real date, not a stale one) —
  // without a frozen clock these submit-payload assertions flake at the UTC
  // midnight boundary instead of testing the payload shape.
  setSystemTime(new Date('2026-08-05T12:00:00Z'));
});

afterAll(() => {
  setSystemTime();
});

const DEFAULT_PROPS = {
  visible: true,
  onDismiss: () => {},
  isSubmitting: false,
  todayISO: '2026-08-05',
  householdTimezone: 'UTC',
  currency: 'GBP',
};

describe('ExpenseAddSheet — add mode', () => {
  it('defaults to the expense kind with the amount field visible', () => {
    const { getByTestId, queryByTestId } = render(
      <ExpenseAddSheet {...DEFAULT_PROPS} onSubmit={() => {}} />
    );
    expect(getByTestId('expense-add-amount-input')).toBeTruthy();
    expect(queryByTestId('expense-add-miles-input')).toBeNull();
  });

  it('submit is disabled until a description and a valid amount are entered', () => {
    const { getByTestId } = render(
      <ExpenseAddSheet {...DEFAULT_PROPS} onSubmit={() => {}} />
    );
    expect(getByTestId('expense-add-submit').props.disabled).toBe(true);

    fireEvent.changeText(
      getByTestId('expense-add-description-input'),
      'Soft play tickets'
    );
    fireEvent.changeText(getByTestId('expense-add-amount-input'), '12.00');

    expect(getByTestId('expense-add-submit').props.disabled).toBe(false);
  });

  it('submits a valid expense-kind request, never carrying `miles`', () => {
    const onSubmit = mock((_input: CreateExpenseRequest) => {});
    const { getByTestId } = render(
      <ExpenseAddSheet {...DEFAULT_PROPS} onSubmit={onSubmit} />
    );

    fireEvent.changeText(
      getByTestId('expense-add-description-input'),
      'Soft play tickets'
    );
    fireEvent.changeText(getByTestId('expense-add-amount-input'), '12.00');
    fireEvent.press(getByTestId('expense-add-submit'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0]?.[0];
    expect(submitted).toEqual({
      kind: 'expense',
      local_date: '2026-08-05',
      description: 'Soft play tickets',
      amount_minor: 1200,
      currency: 'GBP',
    });
    expect(submitted).not.toHaveProperty('miles');
  });

  it('switching to mileage swaps the field and shows the rate hint when a rate is set', () => {
    const { getByTestId, queryByTestId } = render(
      <ExpenseAddSheet
        {...DEFAULT_PROPS}
        onSubmit={() => {}}
        mileageRateMinor={45}
      />
    );

    fireEvent.press(getByTestId('expense-add-kind-mileage'));

    expect(queryByTestId('expense-add-amount-input')).toBeNull();
    expect(getByTestId('expense-add-miles-input')).toBeTruthy();
    expect(getByTestId('expense-add-mileage-rate-hint')).toBeTruthy();
  });

  it('shows the "no rate set yet" hint when the household has no mileage rate', () => {
    const { getByTestId } = render(
      <ExpenseAddSheet
        {...DEFAULT_PROPS}
        onSubmit={() => {}}
        mileageRateMinor={null}
      />
    );

    fireEvent.press(getByTestId('expense-add-kind-mileage'));

    expect(getByTestId('expense-add-mileage-rate-missing-hint')).toBeTruthy();
  });

  it('rejects miles with more than one decimal place, client-side, with a clear message', () => {
    const onSubmit = mock(() => {});
    const { getByTestId } = render(
      <ExpenseAddSheet {...DEFAULT_PROPS} onSubmit={onSubmit} />
    );

    fireEvent.press(getByTestId('expense-add-kind-mileage'));
    fireEvent.changeText(
      getByTestId('expense-add-description-input'),
      'Nursery run'
    );
    fireEvent.changeText(getByTestId('expense-add-miles-input'), '12.456');

    expect(getByTestId('expense-add-miles-error')).toBeTruthy();
    expect(getByTestId('expense-add-submit').props.disabled).toBe(true);

    fireEvent.press(getByTestId('expense-add-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a valid mileage-kind request, never carrying `amount_minor`', () => {
    const onSubmit = mock((_input: CreateExpenseRequest) => {});
    const { getByTestId } = render(
      <ExpenseAddSheet {...DEFAULT_PROPS} onSubmit={onSubmit} />
    );

    fireEvent.press(getByTestId('expense-add-kind-mileage'));
    fireEvent.changeText(
      getByTestId('expense-add-description-input'),
      'Nursery run'
    );
    fireEvent.changeText(getByTestId('expense-add-miles-input'), '12.4');
    fireEvent.press(getByTestId('expense-add-submit'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0]?.[0];
    expect(submitted).toEqual({
      kind: 'mileage',
      local_date: '2026-08-05',
      description: 'Nursery run',
      miles: 12.4,
      currency: 'GBP',
    });
    expect(submitted).not.toHaveProperty('amount_minor');
  });
});

describe('ExpenseAddSheet — edit mode', () => {
  const pendingExpense = {
    id: 'expense-1',
    household_id: 'household-1',
    carer_id: 'nanny-1',
    local_date: '2026-08-03',
    kind: 'expense' as const,
    description: 'Soft play tickets',
    amount_minor: 1200,
    miles: null,
    currency: 'GBP',
    status: 'pending' as const,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    carer_display_name: 'Amara',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };

  it('seeds every field from `initialExpense`', () => {
    const { getByTestId } = render(
      <ExpenseAddSheet
        {...DEFAULT_PROPS}
        onSubmit={() => {}}
        initialExpense={pendingExpense}
      />
    );

    expect(getByTestId('expense-add-description-input').props.value).toBe(
      'Soft play tickets'
    );
    expect(getByTestId('expense-add-amount-input').props.value).toBe('12.00');
  });
});
