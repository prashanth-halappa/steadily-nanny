/**
 * @module domains/expenses/utils/buildExpenseRequest
 *
 * Pure form-state -> `CreateExpenseRequest | null` builder for
 * `ExpenseAddSheet`, mirroring `domains/pay/utils/payArrangementForm.ts`'s
 * `buildCreatePayArrangementRequest`: returns `null` — never a
 * partial/guessed payload — when the form isn't submittable yet, and drives
 * both the submit button's disabled state and the actual submitted body,
 * so those two can never disagree.
 *
 * The returned shape is the discriminated-union variant matching
 * `CreateExpenseRequestSchema`'s STRICT per-kind fields: an `expense`
 * result never carries `miles`, a `mileage` result never carries
 * `amount_minor` — the mileage amount is computed and frozen server-side at
 * approval (docs/11-MONEY.md §6/§8/§9), so a client-built payload must never
 * be able to smuggle one in even by an empty/undefined field surviving
 * `JSON.stringify`.
 */
import type { CreateExpenseRequest } from '@steadily-nanny/shared-types/schemas/expense.schema';
import { parseMajorToMinor } from '@/src/lib/money';
import { isOnOrBeforeToday } from '../components/ExpenseDateField.utils';
import { parseMilesInput } from './miles';

export interface ExpenseFormState {
  kind: 'expense' | 'mileage';
  /** Nominal "yyyy-mm-dd". */
  localDateISO: string;
  description: string;
  /** Only read when `kind === 'expense'`. */
  amountText: string;
  /** Only read when `kind === 'mileage'`. */
  milesText: string;
  currency: string;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function buildExpenseRequest(
  state: ExpenseFormState,
  todayISO: string
): CreateExpenseRequest | null {
  const description = state.description.trim();
  if (description === '') return null;
  if (!ISO_DATE_PATTERN.test(state.localDateISO)) return null;
  if (!isOnOrBeforeToday(state.localDateISO, todayISO)) return null;

  if (state.kind === 'expense') {
    const amountMinor = parseMajorToMinor(state.amountText);
    if (amountMinor === null) return null;
    return {
      kind: 'expense',
      local_date: state.localDateISO,
      description,
      amount_minor: amountMinor,
      currency: state.currency,
    };
  }

  const miles = parseMilesInput(state.milesText);
  if (miles === null) return null;
  return {
    kind: 'mileage',
    local_date: state.localDateISO,
    description,
    miles,
    currency: state.currency,
  };
}
