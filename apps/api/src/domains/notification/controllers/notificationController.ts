/**
 * Notification controller — HTTP layer only.
 *
 * @module domains/notification/controllers/notificationController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import type {
  RegisterDeviceInput,
  UpdateNotificationPrefsInput,
} from '../schemas';
import { registerDevice } from '../services/deviceRegistrationService';
import { getPrefs, updatePrefs } from '../services/notificationPrefsService';

export const NotificationController = {
  /**
   * POST /api/v1/notifications/devices — register or refresh the caller's
   * device. Body is already validated by `authWithValidation(RegisterDeviceSchema)`.
   */
  async registerDevice(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const device = await registerDevice(
        userId,
        req.body as RegisterDeviceInput
      );
      sendSuccessResponse(res, 'Device registered', { device }, 201);
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/notifications/prefs — caller's prefs (defaults if no row).
   */
  async getPrefs(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const prefs = await getPrefs(userId);
      sendSuccessResponse(res, 'Notification prefs', { prefs });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/v1/notifications/prefs — upsert a partial prefs update.
   */
  async updatePrefs(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const prefs = await updatePrefs(
        userId,
        req.body as UpdateNotificationPrefsInput
      );
      sendSuccessResponse(res, 'Notification prefs updated', { prefs });
    } catch (error) {
      next(error);
    }
  },
};
