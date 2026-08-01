/**
 * Availability domain barrel — carer availability windows, time off, and the
 * anonymised cross-household busy-blocks read.
 *
 * @module domains/availability
 */
export * from './controllers/availabilityController';
export * from './controllers/timeOffController';
export * from './errors/availabilityErrors';
export * from './repositories/busyBlockRepository';
export * from './repositories/carerAvailabilityRepository';
export * from './repositories/carerTimeOffRepository';
export { default as availabilityRoutes } from './routes/availabilityRoutes';
export { default as timeOffRoutes } from './routes/timeOffRoutes';
export * from './schemas';
export * from './services/availabilityCommandService';
export * from './services/availabilityQueryService';
export * from './services/timeOffCommandService';
export * from './services/timeOffQueryService';
