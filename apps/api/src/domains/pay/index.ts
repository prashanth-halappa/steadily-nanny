/**
 * Pay domain barrel — the money primitives: effective-dated pay arrangements
 * per household-carer pair (Tier 0 Phase 1) and the weekly earnings engine
 * (Phase 2). Later phases extend this domain with the PTO ledger and
 * expenses.
 *
 * Read `docs/11-MONEY.md` before touching anything here.
 *
 * NOTE FOR CROSS-DOMAIN CALLERS: the timesheet domain imports
 * `services/weekEarningsService` by its concrete path, not through this
 * barrel. That is deliberate — the wrapper itself imports the timesheet
 * domain's repositories, so barrel-to-barrel imports between the two would
 * form a cycle. Keep cross-domain imports concrete in both directions.
 *
 * @module domains/pay
 */
export * from './controllers/expenseController';
export * from './controllers/payArrangementController';
export * from './controllers/paymentController';
export * from './controllers/ptoController';
export * from './controllers/reimbursementSettlementController';
export * from './errors/payErrors';
export * from './repositories/expenseRepository';
export * from './repositories/payArrangementAckRepository';
export * from './repositories/payArrangementRepository';
export * from './repositories/paymentRepository';
export * from './repositories/ptoLedgerRepository';
export * from './repositories/reimbursementSettlementRepository';
export {
  default as expenseRoutes,
  expenseIdRoutes,
} from './routes/expenseRoutes';
export { default as householdPaymentRoutes } from './routes/householdPaymentRoutes';
export { default as payArrangementRoutes } from './routes/payArrangementRoutes';
export { default as paymentRoutes } from './routes/paymentRoutes';
export { default as ptoRoutes } from './routes/ptoRoutes';
export { default as reimbursementSettlementRoutes } from './routes/reimbursementSettlementRoutes';
export * from './schemas';
export * from './services/earningsService';
export * from './services/expenseCommandService';
export * from './services/expenseQueryService';
export * from './services/payArrangementAckService';
export * from './services/payArrangementCommandService';
export * from './services/payArrangementQueryService';
export * from './services/paymentCommandService';
export * from './services/paymentQueryService';
export * from './services/ptoCommandService';
export * from './services/ptoQueryService';
export * from './services/reimbursementSettlementService';
export * from './services/weekEarningsService';
