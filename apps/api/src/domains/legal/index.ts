/**
 * Legal domain barrel — Terms of Service and Privacy Policy clickwrap
 * acceptance status and append-only audit trail.
 *
 * @module domains/legal
 */
export * from './controllers/legalController';
export * from './errors/legalErrors';
export * from './repositories/legalAcceptanceRepository';
export { default as legalRoutes } from './routes/legalRoutes';
export * from './schemas';
export * from './services/legalService';
