/**
 * Notification controller — HTTP layer only.
 *
 * @module domains/notification/controllers/notificationController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import type { RegisterDeviceInput } from '../schemas';
import { registerDevice } from '../services/deviceRegistrationService';

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
};
