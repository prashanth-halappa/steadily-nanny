/**
 * Child domain barrel.
 * @module domains/child
 */
export * from './controllers/childCommitmentController';
export * from './controllers/childController';
export * from './errors/childErrors';
export * from './repositories/childCommitmentRepository';
export * from './repositories/childRepository';
export { default as childCommitmentRoutes } from './routes/childCommitmentRoutes';
export { default as childRoutes } from './routes/childRoutes';
export { default as commitmentRoutes } from './routes/commitmentRoutes';
export * from './schemas';
export * from './services/childCommandService';
export * from './services/childCommitmentCommandService';
export * from './services/childCommitmentQueryService';
export * from './services/childQueryService';
export * from './services/coverageGapService';
