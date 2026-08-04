/**
 * Flat, id-scoped shift routes — routing + middleware wiring only. Mounted
 * at `/api/v1/shifts` in `routes/index.ts`. Each route reads as one
 * declarative chain: auth+ownership -> validate(input) ->
 * asyncHandler(controller), same shape as `householdRoutes.ts`.
 *
 * @module domains/shift/routes/shiftRoutes
 */
import { Router } from 'express';
import { authWithOwnership } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ShiftChangeRequestController } from '../controllers/shiftChangeRequestController';
import { ShiftController } from '../controllers/shiftController';
import {
  CreateShiftChangeRequestSchema,
  ParentEditShiftSchema,
  ShiftIdParamSchema,
} from '../schemas';
import { shiftQueryService } from '../services/shiftQueryService';
import type { Shift } from '../types';

const router = Router();

// Shared ownership guard for /:shiftId routes. The lookup throws
// ShiftNotFoundError (-> 404) for both "missing" and "not a member" — see
// shiftQueryService.getOwned.
const shiftOwnership = {
  param: 'shiftId',
  lookup: (userId: string, shiftId: string): Promise<Shift> =>
    shiftQueryService.getOwned(userId, shiftId),
};

// Read one (membership-checked).
router.get(
  '/:shiftId',
  ...authWithOwnership(ShiftIdParamSchema, shiftOwnership),
  asyncHandler(ShiftController.getById)
);

// Parent-only time/note edit — see `shiftCommandService.update` for why this
// is deliberately narrower than the shared `UpdateShiftSchema`.
router.patch(
  '/:shiftId',
  ...authWithOwnership(ShiftIdParamSchema, shiftOwnership),
  validate(ParentEditShiftSchema, 'body'),
  asyncHandler(ShiftController.update)
);

// Carer-only accept pending → confirmed (extra / demoted shifts). Body-less —
// reuses no Create/Update schema (no third shape).
router.post(
  '/:shiftId/accept',
  ...authWithOwnership(ShiftIdParamSchema, shiftOwnership),
  asyncHandler(ShiftController.accept)
);

// Change requests (flows 1d/1e) — propose against an existing shift.
router.post(
  '/:shiftId/change-requests',
  ...authWithOwnership(ShiftIdParamSchema, shiftOwnership),
  validate(CreateShiftChangeRequestSchema, 'body'),
  asyncHandler(ShiftChangeRequestController.create)
);

router.get(
  '/:shiftId/change-requests',
  ...authWithOwnership(ShiftIdParamSchema, shiftOwnership),
  asyncHandler(ShiftChangeRequestController.listForShift)
);

export default router;
