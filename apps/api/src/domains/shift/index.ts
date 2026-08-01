/**
 * Shift domain barrel — read-focused shift access plus the one parent-only
 * time/note edit. The schedule domain remains the sole writer of
 * create/update/delete for pattern-driven shifts (see
 * `domains/schedule/services/scheduleMaterialisationService.ts`).
 *
 * @module domains/shift
 */
export * from './controllers/shiftController';
export * from './errors/shiftErrors';
export * from './repositories/shiftEventRepository';
export * from './repositories/shiftRepository';
export { default as householdShiftRoutes } from './routes/householdShiftRoutes';
export { default as shiftRoutes } from './routes/shiftRoutes';
export * from './schemas';
export * from './services/shiftCommandService';
export * from './services/shiftQueryService';
