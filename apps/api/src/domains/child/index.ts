/**
 * Child domain barrel.
 * @module domains/child
 */
export * from './controllers/childController';
export * from './errors/childErrors';
export * from './repositories/childRepository';
export { default as childRoutes } from './routes/childRoutes';
export * from './schemas';
export * from './services/childCommandService';
export * from './services/childQueryService';
