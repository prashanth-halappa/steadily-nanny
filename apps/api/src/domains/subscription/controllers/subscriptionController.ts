/**
 * Subscription controller — the RevenueCat webhook and the authenticated
 * status/usage reads.
 *
 * @module domains/subscription/controllers/subscriptionController
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../../../middlewares/logger';
import { getAuthUserId } from '../../../utils/asyncHandler';
import {
  sendErrorResponse,
  sendSuccessResponse,
} from '../../../utils/responseHelpers';
import { EntitlementGatingService } from '../services/entitlementGatingService';
import { SubscriptionCommandService } from '../services/subscriptionCommandService';
import { SubscriptionQueryService } from '../services/subscriptionQueryService';
import { UsageTrackingService } from '../services/usageTrackingService';
import type { RevenueCatWebhookPayload } from '../types';

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export const SubscriptionController = {
  /**
   * POST /api/webhooks/revenuecat — RevenueCat webhook. Verifies the shared
   * Authorization secret, then processes the event. Returns 200 for handled
   * (incl. skipped/stale) so RevenueCat stops retrying.
   */
  async handleWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
      if (!expected) {
        logger.error('REVENUECAT_WEBHOOK_SECRET not configured');
        sendErrorResponse(
          res,
          'INTERNAL_ERROR',
          'Server configuration error',
          500
        );
        return;
      }

      const auth = req.headers.authorization ?? '';
      const provided = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
      if (!provided || !safeEqual(provided, expected)) {
        logger.warn('RevenueCat webhook rejected — invalid signature');
        sendErrorResponse(res, 'UNAUTHORIZED', 'Unauthorized', 401);
        return;
      }

      const result = await SubscriptionCommandService.processWebhookEvent(
        req.body as RevenueCatWebhookPayload
      );
      sendSuccessResponse(res, 'Webhook processed', result);
    } catch (error) {
      next(error);
    }
  },

  /** GET /api/v1/subscription/status — the caller's tier + beta status. */
  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const [info, betaAllPro] = await Promise.all([
        SubscriptionQueryService.getSubscriptionInfo(userId),
        EntitlementGatingService.isBetaAllPro(
          userId,
          req.user?.email ?? undefined
        ),
      ]);
      sendSuccessResponse(res, 'Subscription status', { ...info, betaAllPro });
    } catch (error) {
      next(error);
    }
  },

  /** GET /api/v1/subscription/usage — usage across all gated features. */
  async getUsage(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const usage = await UsageTrackingService.getAllUsage(userId);
      sendSuccessResponse(res, 'Usage status', { usage });
    } catch (error) {
      next(error);
    }
  },
};
