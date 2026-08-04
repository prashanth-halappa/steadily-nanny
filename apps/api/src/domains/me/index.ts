/**
 * Me domain barrel — cross-household carer reads + clash-warning helpers.
 *
 * ORCHESTRATOR:
 * 1. Mount routes in `apps/api/src/routes/index.ts`:
 *      import { meRoutes } from '../domains/me';
 *      router.use('/me', meRoutes);
 *    Routes: GET /me/shifts, GET /me/change-requests.
 * 2. Wire clash helpers into shift/pattern writes:
 *      import { collectClashWarningsForCarer } from '../me/services/clashWarning';
 *    Attach the returned `warnings` array to write responses — never throw
 *    ConflictError for overlaps (migration 015: warn, never block).
 *
 * @module domains/me
 */
export * from './controllers/meController';
export { default as meRoutes } from './routes/meRoutes';
export * from './schemas';
export {
  collectClashWarnings,
  collectClashWarningsForCarer,
  intervalsOverlap,
  isOutsideAvailability,
  timeToMinutes,
} from './services/clashWarning';
export * from './services/meQueryService';
