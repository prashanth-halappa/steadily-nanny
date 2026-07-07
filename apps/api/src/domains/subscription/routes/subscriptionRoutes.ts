/**
 * Authenticated subscription routes. Mounted at `/api/v1/subscription` (behind
 * Supabase auth).
 *
 * @module domains/subscription/routes/subscriptionRoutes
 */
import { Router } from 'express';
import { requireAuth } from '../../../middlewares/auth';
import { asyncHandler } from '../../../utils/asyncHandler';
import { SubscriptionController } from '../controllers/subscriptionController';

const router = Router();

router.get(
  '/status',
  requireAuth,
  asyncHandler(SubscriptionController.getStatus)
);
router.get(
  '/usage',
  requireAuth,
  asyncHandler(SubscriptionController.getUsage)
);

export default router;
