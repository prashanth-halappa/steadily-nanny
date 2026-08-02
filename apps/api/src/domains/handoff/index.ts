/**
 * Handoff domain barrel — daily handoff notes between parent and nanny
 * (design flow 1i): chip-based, no AI/voice in v1.
 *
 * @module domains/handoff
 */
export * from './controllers/handoffController';
export * from './errors/handoffErrors';
export * from './repositories/handoffNoteRepository';
export { default as handoffRoutes } from './routes/handoffRoutes';
export { default as householdHandoffRoutes } from './routes/householdHandoffRoutes';
export * from './schemas';
export * from './services/handoffCommandService';
export * from './services/handoffQueryService';
