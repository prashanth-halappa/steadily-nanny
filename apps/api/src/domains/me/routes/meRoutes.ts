/**
 * Me routes — routing + middleware wiring only.
 *
 * ORCHESTRATOR MOUNT (do not edit routes/index.ts from this agent):
 *   import { meRoutes } from '../domains/me';
 *   router.use('/me', meRoutes);
 *
 * Mounted at `/api/v1/me` →
 *   GET /api/v1/me/shifts?from=&to=
 *   GET /api/v1/me/change-requests?from=&to=
 *
 * @module domains/me/routes/meRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { asyncHandler } from '../../../utils/asyncHandler';
import { MeController } from '../controllers/meController';
import { MeShiftRangeQuerySchema } from '../schemas';

const router = Router();

router.get(
  '/shifts',
  ...authWithValidation(MeShiftRangeQuerySchema, 'query'),
  asyncHandler(MeController.listMyShifts)
);

router.get(
  '/change-requests',
  ...authWithValidation(MeShiftRangeQuerySchema, 'query'),
  asyncHandler(MeController.listPendingChangeRequests)
);

export default router;
