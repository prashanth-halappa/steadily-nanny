/**
 * RevenueCat webhook routes. Mounted at `/api/webhooks` BEFORE the Supabase auth
 * layer (see app.ts) — the webhook authenticates with its own shared secret.
 *
 * @module domains/subscription/routes/subscriptionWebhookRoutes
 */
import { Router } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { SubscriptionController } from '../controllers/subscriptionController';

const router = Router();

// POST /api/webhooks/revenuecat
router.post('/revenuecat', asyncHandler(SubscriptionController.handleWebhook));

export default router;
