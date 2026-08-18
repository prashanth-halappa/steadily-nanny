/**
 * Pay-period grouping — PRESENTATION ONLY (D-17, T7 reversal).
 *
 * The implementation MOVED to `@steadily-nanny/shared-types/payPeriod` so the
 * app can print the same period end and due date the server stamps on an
 * export row — read that module's header for the rules. This file stays as a
 * re-export barrel so the pay domain's own `../utils/payPeriod` imports (and
 * `timesheetQueryService`'s cross-domain one) keep resolving, exactly as
 * `domains/timesheet/schemas.ts` re-exports the shared timesheet contract.
 *
 * @module domains/pay/utils/payPeriod
 */
export {
  computePayDueDate,
  computePayPeriodEnd,
  type PayDueDateInput,
  type PayPeriodInput,
} from '@steadily-nanny/shared-types/payPeriod';
