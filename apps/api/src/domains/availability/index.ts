/**
 * Availability domain barrel — carer availability windows, time off,
 * anonymised busy-blocks, and parent-declared household closures.
 *
 * @module domains/availability
 */
export * from './controllers/availabilityController';
export * from './controllers/householdClosureController';
export * from './controllers/timeOffController';
export * from './errors/availabilityErrors';
export * from './repositories/busyBlockRepository';
export * from './repositories/carerAvailabilityRepository';
export * from './repositories/carerTimeOffRepository';
export * from './repositories/householdClosureRepository';
export * from './repositories/overlappingShiftRepository';
export { default as availabilityRoutes } from './routes/availabilityRoutes';
export { default as householdClosureRoutes } from './routes/householdClosureRoutes';
export { default as householdTimeOffRoutes } from './routes/householdTimeOffRoutes';
export { default as timeOffRoutes } from './routes/timeOffRoutes';
export * from './schemas';
export * from './services/availabilityCommandService';
export * from './services/availabilityQueryService';
export * from './services/householdClosureCommandService';
export * from './services/householdClosureQueryService';
export * from './services/timeOffCommandService';
export * from './services/timeOffQueryService';
