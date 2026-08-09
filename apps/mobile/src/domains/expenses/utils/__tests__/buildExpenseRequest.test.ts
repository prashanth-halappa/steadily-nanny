/**
 * @module domains/expenses/utils/__tests__/buildExpenseRequest.test
 * Pure form-state -> `CreateExpenseRequest | null` builder for
 * `ExpenseAddSheet`. Mirrors `payArrangementForm.ts`'s
 * `buildCreatePayArrangementRequest` discipline: returns `null` (never a
 * partial/guessed payload) when the form isn't submittable yet, and the
 * discriminated shape it DOES build always matches
 * `CreateExpenseRequestSchema`'s strict per-kind fields — an expense
 * variant never carries `miles`, a mileage variant never carries
 * `amount_minor` (docs/11-MONEY.md §6/§8/§9).
 */
import { describe, expect, it } from 'bun:test';
import { buildExpenseRequest } from '../buildExpenseRequest';

const TODAY = '2026-08-10';

const BASE = {
  kind: 'expense' as const,
  localDateISO: '2026-08-03',
  description: 'Soft play tickets',
  amountText: '12.00',
  milesText: '',
  currency: 'GBP',
};

describe('buildExpenseRequest — expense kind', () => {
  it('builds a valid expense request', () => {
    expect(buildExpenseRequest(BASE, TODAY)).toEqual({
      kind: 'expense',
      local_date: '2026-08-03',
      description: 'Soft play tickets',
      amount_minor: 1200,
      currency: 'GBP',
    });
  });

  it('returns null when the description is blank', () => {
    expect(
      buildExpenseRequest({ ...BASE, description: '   ' }, TODAY)
    ).toBeNull();
  });

  it('returns null when the amount cannot be parsed', () => {
    expect(
      buildExpenseRequest({ ...BASE, amountText: 'abc' }, TODAY)
    ).toBeNull();
  });

  it('returns null when the date is not a valid calendar date', () => {
    expect(
      buildExpenseRequest({ ...BASE, localDateISO: 'not-a-date' }, TODAY)
    ).toBeNull();
  });

  it('returns null when the date is after today', () => {
    expect(
      buildExpenseRequest({ ...BASE, localDateISO: '2026-08-15' }, TODAY)
    ).toBeNull();
  });

  it('never includes `miles` on an expense-kind payload', () => {
    const result = buildExpenseRequest(BASE, TODAY);
    expect(result).not.toHaveProperty('miles');
  });
});

describe('buildExpenseRequest — mileage kind', () => {
  const mileageState = {
    ...BASE,
    kind: 'mileage' as const,
    description: 'Nursery run',
    amountText: '',
    milesText: '12.4',
  };

  it('builds a valid mileage request', () => {
    expect(buildExpenseRequest(mileageState, TODAY)).toEqual({
      kind: 'mileage',
      local_date: '2026-08-03',
      description: 'Nursery run',
      miles: 12.4,
      currency: 'GBP',
    });
  });

  it('never includes `amount_minor` on a mileage-kind payload', () => {
    const result = buildExpenseRequest(mileageState, TODAY);
    expect(result).not.toHaveProperty('amount_minor');
  });

  it('returns null when miles has more than one decimal place', () => {
    expect(
      buildExpenseRequest({ ...mileageState, milesText: '12.45' }, TODAY)
    ).toBeNull();
  });

  it('returns null when miles is zero or blank', () => {
    expect(
      buildExpenseRequest({ ...mileageState, milesText: '0' }, TODAY)
    ).toBeNull();
    expect(
      buildExpenseRequest({ ...mileageState, milesText: '' }, TODAY)
    ).toBeNull();
  });
});
