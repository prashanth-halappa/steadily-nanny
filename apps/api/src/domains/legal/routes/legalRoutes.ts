/**
 * Legal routes — mounted at `/api/v1/legal` (behind `validateSession`).
 *
 * @module domains/legal/routes/legalRoutes
 */
import { Router } from 'express';
import { requireAuth } from '../../../middlewares/auth';
import { authWithValidation } from '../../../middlewares/presets';
import { asyncHandler } from '../../../utils/asyncHandler';
import { LegalController } from '../controllers/legalController';
import { AcceptLegalRequestSchema } from '../schemas';

const router = Router();

router.get('/acceptance', requireAuth, asyncHandler(LegalController.getStatus));
router.post(
  '/acceptance',
  ...authWithValidation(AcceptLegalRequestSchema, 'body'),
  asyncHandler(LegalController.accept)
);

export default router;
