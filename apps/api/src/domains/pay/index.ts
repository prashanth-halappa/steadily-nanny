/**
 * Pay domain barrel — the money primitives: effective-dated pay arrangements
 * per household-carer pair (Tier 0 Phase 1). Later phases extend this domain
 * with the earnings engine, the PTO ledger, and expenses.
 *
 * Read `docs/11-MONEY.md` before touching anything here.
 *
 * @module domains/pay
 */
export * from './controllers/payArrangementController';
export * from './errors/payErrors';
export * from './repositories/payArrangementRepository';
export { default as payArrangementRoutes } from './routes/payArrangementRoutes';
export * from './schemas';
export * from './services/payArrangementCommandService';
export * from './services/payArrangementQueryService';
