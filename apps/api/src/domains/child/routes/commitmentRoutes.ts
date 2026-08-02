/**
 * Flat, id-scoped commitment routes — routing + middleware wiring only.
 * Mounted at `/api/v1/commitments` in `routes/index.ts`, mirroring the shift
 * domain's flat `/shifts/:shiftId` pattern (`domains/shift/routes/
 * shiftRoutes.ts`): a commitment is edited or deleted by its own id, with no
 * household id in the URL to validate against.
 *
 * @module domains/child/routes/commitmentRoutes
 */
import { Router } from 'express';
import { authWithOwnership } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ChildCommitmentController } from '../controllers/childCommitmentController';
import {
  ChildCommitmentIdParamSchema,
  UpdateChildCommitmentSchema,
} from '../schemas';
import { childCommitmentQueryService } from '../services/childCommitmentQueryService';
import type { ChildCommitment } from '../types';

const router = Router();

// Shared ownership guard for /:commitmentId routes. The lookup throws
// ChildCommitmentNotFoundError (-> 404) for both "missing" and "not a
// member" — see childCommitmentQueryService.getOwned.
const commitmentOwnership = {
  param: 'commitmentId',
  lookup: (userId: string, commitmentId: string): Promise<ChildCommitment> =>
    childCommitmentQueryService.getOwned(userId, commitmentId),
};

router.patch(
  '/:commitmentId',
  ...authWithOwnership(ChildCommitmentIdParamSchema, commitmentOwnership),
  validate(UpdateChildCommitmentSchema, 'body'),
  asyncHandler(ChildCommitmentController.update)
);

router.delete(
  '/:commitmentId',
  ...authWithOwnership(ChildCommitmentIdParamSchema, commitmentOwnership),
  asyncHandler(ChildCommitmentController.remove)
);

export default router;
