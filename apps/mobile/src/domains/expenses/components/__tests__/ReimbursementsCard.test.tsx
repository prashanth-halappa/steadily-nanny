/**
 * @module domains/expenses/components/__tests__/ReimbursementsCard.test
 * TIER0-CX-SPEC.md §6.3: a separate card, an `AmountRow` per approved item,
 * a `rounded-cell bg-muted` subtotal row "Total to reimburse", the
 * mandatory "not wages" note — and NOT rendered at all when the week has no
 * expenses. §8: a rejected row is excluded from the subtotal — this
 * component only ever receives approved rows from its caller, so this test
 * asserts a rejected row passed in by mistake still never inflates the
 * total (defence in depth, not the primary guarantee — the caller filters).
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Expense } from '@steadily-nanny/shared-types/schemas/expense.schema';
import { fireEvent, render } from '@testing-library/react-native';

let ReimbursementsCard: typeof import('../ReimbursementsCard').ReimbursementsCard;

beforeAll(async () => {
  // The global key-echo `t` drops interpolation values, which would make
  // "Reimbursed on 18 August" indistinguishable from a settled line with no
  // date at all. This file's `t` appends them so the date is assertable.
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) =>
        opts ? `${key}|${JSON.stringify(opts)}` : key,
      i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
    }),
    Trans: ({ children }: any) => children,
    initReactI18next: { type: '3rdParty', init: () => {} },
  }));

  ReimbursementsCard = (await import('../ReimbursementsCard'))
    .ReimbursementsCard;
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
    status: 'approved',
    reviewed_by: 'parent-1',
    reviewed_at: '2026-08-04T00:00:00.000Z',
    review_note: null,
    carer_display_name: 'Amara',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ReimbursementsCard', () => {
  it('renders nothing when there are no approved expenses', () => {
    const { queryByTestId } = render(
      <ReimbursementsCard
        testID="reimbursements-card"
        approvedExpenses={[]}
        totalMinor={0}
        currency="GBP"
      />
    );
    expect(queryByTestId('reimbursements-card')).toBeNull();
  });

  it('renders an AmountRow per approved item and the frozen subtotal', () => {
    const { getByTestId } = render(
      <ReimbursementsCard
        testID="reimbursements-card"
        approvedExpenses={[
          makeExpense({ id: 'expense-1', amount_minor: 1200 }),
          makeExpense({
            id: 'expense-2',
            kind: 'mileage',
            amount_minor: 2280,
            miles: 12.4,
          }),
        ]}
        totalMinor={3480}
        currency="GBP"
      />
    );

    expect(getByTestId('reimbursements-card')).toBeTruthy();
    expect(
      getByTestId('reimbursements-card-line-expense-1-value').props.children
    ).toBe('£12.00');
    expect(
      getByTestId('reimbursements-card-line-expense-2-value').props.children
    ).toBe('£22.80');
    expect(getByTestId('reimbursements-card-total').props.children).toBe(
      '£34.80'
    );
  });

  it('renders the carer name under the title when the caller supplies it', () => {
    const { getByTestId } = render(
      <ReimbursementsCard
        testID="reimbursements-card"
        approvedExpenses={[makeExpense()]}
        totalMinor={1200}
        currency="GBP"
        carerName="Amara Diallo"
      />
    );
    expect(getByTestId('reimbursements-card-carer-name').props.children).toBe(
      'Amara Diallo'
    );
  });

  it('omits the carer-name caption when the prop is not supplied', () => {
    const { queryByTestId } = render(
      <ReimbursementsCard
        testID="reimbursements-card"
        approvedExpenses={[makeExpense()]}
        totalMinor={1200}
        currency="GBP"
      />
    );
    expect(queryByTestId('reimbursements-card-carer-name')).toBeNull();
  });

  it('mandatory "not wages" note is present', () => {
    const { getByTestId } = render(
      <ReimbursementsCard
        testID="reimbursements-card"
        approvedExpenses={[makeExpense()]}
        totalMinor={1200}
        currency="GBP"
      />
    );
    expect(getByTestId('reimbursements-card-note')).toBeTruthy();
  });

  // Phase 3+4 adversarial review, finding 7: `?? 0` at the call site turned
  // "the server has no total to give" into a fabricated "£0.00" rendered
  // above real, non-zero itemised amounts. `totalMinor={null}` must never
  // render £0.00 — the items still list, only the subtotal is withheld.
  it('finding 7: totalMinor=null renders the items with NO total row and NEVER "£0.00"', () => {
    const { getByTestId, queryByTestId, queryAllByText } = render(
      <ReimbursementsCard
        testID="reimbursements-card"
        approvedExpenses={[
          makeExpense({ id: 'expense-1', amount_minor: 1200 }),
          makeExpense({
            id: 'expense-2',
            kind: 'mileage',
            amount_minor: 2280,
            miles: 12.4,
          }),
        ]}
        totalMinor={null}
        currency="GBP"
      />
    );

    // The real itemised amounts still render.
    expect(
      getByTestId('reimbursements-card-line-expense-1-value').props.children
    ).toBe('£12.00');
    expect(
      getByTestId('reimbursements-card-line-expense-2-value').props.children
    ).toBe('£22.80');

    // No total row, and nowhere on the card does a fabricated £0.00 appear.
    expect(queryByTestId('reimbursements-card-total')).toBeNull();
    expect(getByTestId('reimbursements-card-total-unavailable')).toBeTruthy();
    expect(queryAllByText('£0.00')).toHaveLength(0);
  });

  // --- attention spec §4.2: settlement state words + the parent-only action --
  it('unsettled: states "approved, not reimbursed yet" and offers the action when the parent supplies it', () => {
    const onMarkReimbursedPress = mock(() => {});
    const { getByTestId } = render(
      <ReimbursementsCard
        testID="reimbursements-card"
        approvedExpenses={[makeExpense()]}
        totalMinor={1200}
        currency="GBP"
        onMarkReimbursedPress={onMarkReimbursedPress}
      />
    );

    expect(getByTestId('reimbursements-card-state').props.children).toBe(
      'reimbursements.stateUnsettled'
    );
    fireEvent.press(getByTestId('reimbursements-card-mark-reimbursed-button'));
    expect(onMarkReimbursedPress).toHaveBeenCalledTimes(1);
  });

  it('omits the action entirely when onMarkReimbursedPress is not supplied (the nanny view)', () => {
    const { getByTestId, queryByTestId } = render(
      <ReimbursementsCard
        testID="reimbursements-card"
        approvedExpenses={[makeExpense()]}
        totalMinor={1200}
        currency="GBP"
      />
    );

    // State words are for both roles; the action is not.
    expect(getByTestId('reimbursements-card-state').props.children).toBe(
      'reimbursements.stateUnsettled'
    );
    expect(
      queryByTestId('reimbursements-card-mark-reimbursed-button')
    ).toBeNull();
  });

  it('settled: states the settlement date and drops the action even for the parent', () => {
    const { getByTestId, queryByTestId } = render(
      <ReimbursementsCard
        testID="reimbursements-card"
        approvedExpenses={[makeExpense()]}
        totalMinor={1200}
        currency="GBP"
        settledOn="2026-08-18"
        onMarkReimbursedPress={mock(() => {})}
      />
    );

    expect(getByTestId('reimbursements-card-state').props.children).toBe(
      'reimbursements.stateSettled|{"date":"18 August"}'
    );
    expect(
      queryByTestId('reimbursements-card-mark-reimbursed-button')
    ).toBeNull();
  });

  // GOLDEN-FIXES #40: the refusal belongs next to the button that caused it.
  it('renders a failed settlement inline, under the action', () => {
    const { getByTestId } = render(
      <ReimbursementsCard
        testID="reimbursements-card"
        approvedExpenses={[makeExpense()]}
        totalMinor={1200}
        currency="GBP"
        onMarkReimbursedPress={mock(() => {})}
        markReimbursedError="Something went wrong"
      />
    );

    expect(
      getByTestId('reimbursements-card-mark-reimbursed-error').props.children
    ).toBe('Something went wrong');
  });

  it('totalMinor=null still states the settlement state and still offers the action', () => {
    const { getByTestId } = render(
      <ReimbursementsCard
        testID="reimbursements-card"
        approvedExpenses={[makeExpense()]}
        totalMinor={null}
        currency="GBP"
        onMarkReimbursedPress={mock(() => {})}
      />
    );

    expect(getByTestId('reimbursements-card-total-unavailable')).toBeTruthy();
    expect(getByTestId('reimbursements-card-state').props.children).toBe(
      'reimbursements.stateUnsettled'
    );
    expect(
      getByTestId('reimbursements-card-mark-reimbursed-button')
    ).toBeTruthy();
  });
});
