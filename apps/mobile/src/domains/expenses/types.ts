/**
 * @module domains/expenses/types
 * Domain-internal re-export barrel over the shared wire contract, so
 * `../types` imports inside `domains/expenses/**` stay stable regardless of
 * where the shared module itself lives — same pattern as
 * `domains/timesheet/types/index.ts`.
 */
export type {
  CreateExpenseRequest,
  Expense,
  ExpenseKind,
  ExpenseStatus,
  ReviewExpenseRequest,
  UpdateExpenseRequest,
} from '@steadily-nanny/shared-types/schemas/expense.schema';
export {
  EXPENSE_KINDS,
  EXPENSE_STATUSES,
} from '@steadily-nanny/shared-types/schemas/expense.schema';
