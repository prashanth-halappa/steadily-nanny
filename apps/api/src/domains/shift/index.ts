/**
 * Shift domain barrel — shift reads, parent time/note edit (consent demotion),
 * carer accept-pending, and change-request / extra-shift flows (1d/1e). The
 * schedule domain remains the sole writer of create/update/delete for
 * pattern-driven shifts (see
 * `domains/schedule/services/scheduleMaterialisationService.ts`).
 *
 * @module domains/shift
 */
export * from './controllers/shiftChangeRequestController';
export * from './controllers/shiftController';
export * from './errors/shiftErrors';
export * from './repositories/shiftChangeRequestRepository';
export * from './repositories/shiftEventRepository';
export * from './repositories/shiftRepository';
export { default as householdShiftRoutes } from './routes/householdShiftRoutes';
export { default as shiftChangeRequestRoutes } from './routes/shiftChangeRequestRoutes';
export { default as shiftRoutes } from './routes/shiftRoutes';
export * from './schemas';
export * from './services/shiftChangeRequestCommandService';
export * from './services/shiftChangeRequestQueryService';
export * from './services/shiftCommandService';
export * from './services/shiftQueryService';
