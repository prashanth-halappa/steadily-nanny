/**
 * Flat, id-scoped change-request routes — mounted at `/api/v1/change-requests`
 * in `routes/index.ts`. Respond/withdraw are keyed by `:changeRequestId`; the
 * shift household is resolved via lookup (same nested-then-flat split as
 * schedule patterns).
 *
 * @module domains/shift/routes/shiftChangeRequestRoutes
 */
import { Router } from 'express';
import { authWithOwnership } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ShiftChangeRequestController } from '../controllers/shiftChangeRequestController';
import {
  RespondToShiftChangeRequestSchema,
  ShiftChangeRequestIdParamSchema,
} from '../schemas';
import { shiftChangeRequestQueryService } from '../services/shiftChangeRequestQueryService';
import type { ShiftChangeRequest } from '../types';

const router = Router();

const changeRequestOwnership = {
  param: 'changeRequestId',
  lookup: (
    userId: string,
    changeRequestId: string
  ): Promise<ShiftChangeRequest> =>
    shiftChangeRequestQueryService.getOwned(userId, changeRequestId),
};

router.post(
  '/:changeRequestId/respond',
  ...authWithOwnership(ShiftChangeRequestIdParamSchema, changeRequestOwnership),
  validate(RespondToShiftChangeRequestSchema, 'body'),
  asyncHandler(ShiftChangeRequestController.respond)
);

router.post(
  '/:changeRequestId/withdraw',
  ...authWithOwnership(ShiftChangeRequestIdParamSchema, changeRequestOwnership),
  asyncHandler(ShiftChangeRequestController.withdraw)
);

export default router;
