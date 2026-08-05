// File: src/api/endpoints/expenses.ts
// Description: API endpoints and Zod response validation for expenses &
// mileage (TIER0-PLAN.md Phase 4). Wire shapes come from the ONE shared
// source — `@steadily-nanny/shared-types/schemas/expense.schema` — never
// redefined here.
//
// Every network call goes through the shared `apiClient` and unwraps the
// standard success envelope `{ success, data, message, ... }` at
// `response.data.data` before validating the payload with Zod.
//
// Reimbursements are not wages (docs/11-MONEY.md §6): this module has no
// idea about gross pay, and the earnings engine's `reimbursements_minor`
// figure never round-trips back through here.
//
// `CreateExpenseRequestSchema`/`UpdateExpenseRequestSchema` are a STRICT
// discriminated union on `kind` — a mileage payload that also carries
// `amount_minor` (or an expense payload carrying `miles`) fails Zod
// validation client-side, before the request ever leaves the device, same
// discipline as `payArrangementApi.create`'s validate-then-throw.

import type {
  CreateExpenseRequest,
  Expense,
  ReviewExpenseRequest,
  UpdateExpenseRequest,
} from '@steadily-nanny/shared-types/schemas/expense.schema';
import {
  CreateExpenseRequestSchema,
  ExpenseListResponseSchema,
  ExpenseSchema,
  ReviewExpenseRequestSchema,
  UpdateExpenseRequestSchema,
} from '@steadily-nanny/shared-types/schemas/expense.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export type {
  ExpenseKind,
  ExpenseStatus,
} from '@steadily-nanny/shared-types/schemas/expense.schema';
export {
  EXPENSE_KINDS,
  EXPENSE_STATUSES,
} from '@steadily-nanny/shared-types/schemas/expense.schema';
// Re-exported so domain-internal imports (`@/src/api/endpoints/expenses`)
// stay stable regardless of where the wire contract itself lives.
export type {
  CreateExpenseRequest,
  Expense,
  ReviewExpenseRequest,
  UpdateExpenseRequest,
};

// --- Endpoint URLs ----------------------------------------------------------
export const expenseEndpoints = {
  listForHousehold: (householdId: string) =>
    `/v1/households/${householdId}/expenses`,
  create: (householdId: string) => `/v1/households/${householdId}/expenses`,
  byId: (expenseId: string) => `/v1/expenses/${expenseId}`,
  review: (expenseId: string) => `/v1/expenses/${expenseId}/review`,
} as const;

// --- API --------------------------------------------------------------------
export const expenseApi = {
  /** One household's expenses/mileage for one household-local week (both
   * pending and reviewed rows — the nanny's own list needs every status,
   * §6.1). `week_start` is a query param, never a path segment. */
  listForWeek: async (
    householdId: string,
    weekStart: string
  ): Promise<Expense[]> => {
    const response = await apiClient.get(
      expenseEndpoints.listForHousehold(householdId),
      { params: { week_start: weekStart } }
    );
    const parsed = ExpenseListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.expenses;
  },

  /** Every still-`pending` expense/mileage row for a household, across all
   * weeks — the parent's "N expenses to review" affordance (§6.2). */
  listPending: async (householdId: string): Promise<Expense[]> => {
    const response = await apiClient.get(
      expenseEndpoints.listForHousehold(householdId),
      { params: { status: 'pending' } }
    );
    const parsed = ExpenseListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.expenses;
  },

  /** Add a new expense or mileage claim. Nanny only — server-gated. Always
   * `pending` on creation; there is no client-settable status here. */
  create: async (
    householdId: string,
    input: CreateExpenseRequest
  ): Promise<Expense> => {
    const validated = CreateExpenseRequestSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      expenseEndpoints.create(householdId),
      validated.data
    );
    const parsed = z
      .object({ expense: ExpenseSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.expense;
  },

  /** Edit a still-`pending` expense the caller owns (docs/11-MONEY.md §8
   * "pending-expense corrections"). Reviewed rows are immutable — the
   * server 409s (`EXPENSE_NOT_EDITABLE`, reason `already_reviewed`). */
  update: async (
    expenseId: string,
    input: UpdateExpenseRequest
  ): Promise<Expense> => {
    const validated = UpdateExpenseRequestSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.patch(
      expenseEndpoints.byId(expenseId),
      validated.data
    );
    const parsed = z
      .object({ expense: ExpenseSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.expense;
  },

  /** Withdraw (hard-delete) a still-`pending` row the caller owns — she adds
   * a fresh one rather than editing a reviewed row into something else. */
  withdraw: async (expenseId: string): Promise<void> => {
    await apiClient.delete(expenseEndpoints.byId(expenseId));
  },

  /** Approve or reject a pending row. Parent only — server-gated. Approving
   * mileage freezes `miles × the effective rate` into `amount_minor`
   * server-side; a household with no mileage rate set refuses with a typed
   * `ExpenseValidationError` (`reason: 'NO_MILEAGE_RATE'`) rather than
   * approving at £0.00 (docs/11-MONEY.md §4's no-arrangement-no-zero rule). */
  review: async (
    expenseId: string,
    input: ReviewExpenseRequest
  ): Promise<Expense> => {
    const validated = ReviewExpenseRequestSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      expenseEndpoints.review(expenseId),
      validated.data
    );
    const parsed = z
      .object({ expense: ExpenseSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.expense;
  },
};
