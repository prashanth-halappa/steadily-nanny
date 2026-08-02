/**
 * Time-off routes — routing + middleware wiring only. Mounted at
 * `/api/v1/time-off` (behind the global Supabase auth).
 *
 * @module domains/availability/routes/timeOffRoutes
 */
import { Router } from 'express';
import { requireAuth } from '../../../middlewares/auth';
import {
  authWithOwnership,
  authWithValidation,
} from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { TimeOffController } from '../controllers/timeOffController';
import {
  CreateCarerTimeOffSchema,
  TimeOffIdParamSchema,
  UpdateCarerTimeOffSchema,
} from '../schemas';
import { timeOffQueryService } from '../services/timeOffQueryService';

const router = Router();

// Ownership guard for /:id. The lookup throws TimeOffNotFoundError (-> 404)
// for both "missing" and "not yours" — see timeOffQueryService.getOwned.
const timeOffOwnership = {
  param: 'id',
  lookup: (userId: string, id: string) =>
    timeOffQueryService.getOwned(userId, id),
};

// List the caller's own time-off rows.
router.get('/', requireAuth, asyncHandler(TimeOffController.list));

// Create — no ownership concept yet (the row doesn't exist).
router.post(
  '/',
  ...authWithValidation(CreateCarerTimeOffSchema, 'body'),
  asyncHandler(TimeOffController.create)
);

// Edit dates/message — ownership-checked.
router.patch(
  '/:id',
  ...authWithOwnership(TimeOffIdParamSchema, timeOffOwnership),
  validate(UpdateCarerTimeOffSchema, 'body'),
  asyncHandler(TimeOffController.update)
);

// Cancel (soft delete) — ownership-checked.
router.delete(
  '/:id',
  ...authWithOwnership(TimeOffIdParamSchema, timeOffOwnership),
  asyncHandler(TimeOffController.remove)
);

export default router;
