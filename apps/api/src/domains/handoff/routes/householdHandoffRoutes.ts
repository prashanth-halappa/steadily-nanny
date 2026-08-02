/**
 * Household-nested handoff-note routes — routing + middleware wiring only.
 * Mounted at `/api/v1/households/:householdId/handoff-notes` in
 * `routes/index.ts`. Membership checks live in the service layer (see
 * `handoffQueryService`/`handoffCommandService`), same as the shift domain's
 * household-nested routes, rather than the generic single-param ownership
 * middleware — these routes are scoped by the household id alone.
 *
 * @module domains/handoff/routes/householdHandoffRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { HandoffNoteController } from '../controllers/handoffController';
import {
  CreateHandoffNoteSchema,
  HouseholdIdParamSchema,
  LocalDateQuerySchema,
} from '../schemas';

// mergeParams so `:householdId` from the parent mount is visible on req.params.
const router = Router({ mergeParams: true });

// The evening recap. No `/:id`-shaped route exists on this router, but keep
// the more specific path first regardless, per the shift/schedule domains'
// convention.
router.get(
  '/recap',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(LocalDateQuerySchema, 'query'),
  asyncHandler(HandoffNoteController.recap)
);

router.get(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(LocalDateQuerySchema, 'query'),
  asyncHandler(HandoffNoteController.list)
);

// Any active member may create — see handoffCommandService.create.
router.post(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(CreateHandoffNoteSchema, 'body'),
  asyncHandler(HandoffNoteController.create)
);

export default router;
