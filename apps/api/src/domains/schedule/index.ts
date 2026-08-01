/**
 * Schedule domain barrel — recurring "usual week" patterns (draft -> pending
 * -> accepted/declined/withdrawn/ended), the recurrence expander, and
 * idempotent shift materialisation.
 *
 * @module domains/schedule
 */
export * from './controllers/schedulePatternController';
export * from './errors/scheduleErrors';
export * from './repositories/schedulePatternDayChildRepository';
export * from './repositories/schedulePatternDayRepository';
export * from './repositories/schedulePatternRepository';
export * from './repositories/scheduleShiftRepository';
export { default as householdSchedulePatternRoutes } from './routes/householdSchedulePatternRoutes';
export { default as schedulePatternRoutes } from './routes/schedulePatternRoutes';
export * from './schemas';
export * from './services/recurrenceExpander';
export * from './services/scheduleMaterialisationService';
export * from './services/schedulePatternCommandService';
export * from './services/schedulePatternQueryService';
