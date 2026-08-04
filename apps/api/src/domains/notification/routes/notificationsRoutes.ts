/**
 * Notification routes. Mounted at `/api/v1/notifications` (behind Supabase auth).
 *
 * @module domains/notification/routes/notificationsRoutes
 */
import { Router } from 'express';
import { requireAuth } from '../../../middlewares/auth';
import { authWithValidation } from '../../../middlewares/presets';
import { asyncHandler } from '../../../utils/asyncHandler';
import { NotificationController } from '../controllers/notificationController';
import {
  RegisterDeviceSchema,
  UpdateNotificationPrefsSchema,
} from '../schemas';

const router = Router();

router.post(
  '/devices',
  ...authWithValidation(RegisterDeviceSchema, 'body'),
  asyncHandler(NotificationController.registerDevice)
);

router.get(
  '/prefs',
  requireAuth,
  asyncHandler(NotificationController.getPrefs)
);

router.patch(
  '/prefs',
  ...authWithValidation(UpdateNotificationPrefsSchema, 'body'),
  asyncHandler(NotificationController.updatePrefs)
);

export default router;
