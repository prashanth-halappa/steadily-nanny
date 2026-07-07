/**
 * Notification routes. Mounted at `/api/v1/notifications` (behind Supabase auth).
 *
 * @module domains/notification/routes/notificationsRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { asyncHandler } from '../../../utils/asyncHandler';
import { NotificationController } from '../controllers/notificationController';
import { RegisterDeviceSchema } from '../schemas';

const router = Router();

router.post(
  '/devices',
  ...authWithValidation(RegisterDeviceSchema, 'body'),
  asyncHandler(NotificationController.registerDevice)
);

export default router;
