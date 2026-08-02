/**
 * Flat, id-scoped handoff-note routes — routing + middleware wiring only.
 * Mounted at `/api/v1/handoff-notes` in `routes/index.ts`. Same declarative
 * chain shape as `shiftRoutes.ts`: auth+ownership -> validate(input) ->
 * asyncHandler(controller).
 *
 * @module domains/handoff/routes/handoffRoutes
 */
import { Router } from 'express';
import { authWithOwnership } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { HandoffNoteController } from '../controllers/handoffController';
import { HandoffNoteIdParamSchema, UpdateHandoffNoteSchema } from '../schemas';
import { handoffQueryService } from '../services/handoffQueryService';
import type { HandoffNote } from '../types';

const router = Router();

// Shared ownership guard for /:handoffNoteId routes. The lookup throws
// HandoffNoteNotFoundError (-> 404) for both "missing" and "not a member" —
// see handoffQueryService.getOwned. Author-vs-parent authorization for the
// PATCH itself happens in handoffCommandService.update, same split as
// shiftRoutes.ts/shiftCommandService.
const handoffNoteOwnership = {
  param: 'handoffNoteId',
  lookup: (userId: string, handoffNoteId: string): Promise<HandoffNote> =>
    handoffQueryService.getOwned(userId, handoffNoteId),
};

router.patch(
  '/:handoffNoteId',
  ...authWithOwnership(HandoffNoteIdParamSchema, handoffNoteOwnership),
  validate(UpdateHandoffNoteSchema, 'body'),
  asyncHandler(HandoffNoteController.update)
);

export default router;
