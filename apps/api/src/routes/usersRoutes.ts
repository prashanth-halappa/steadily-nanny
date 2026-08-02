/**
 * User routes — mounted at `/api/v1/users` (behind Supabase auth).
 *
 * @module routes/usersRoutes
 */
import { Router } from 'express';
import { UserController } from '../domains/user/controllers/userController';
import { requireAuth } from '../middlewares/auth';
import { authWithValidation } from '../middlewares/presets';
import {
  UpdateProfileSchema,
  UpsertProfileSchema,
} from '../schemas/user.schema';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.get('/me', requireAuth, asyncHandler(UserController.getMe));
router.get(
  '/me/memberships',
  requireAuth,
  asyncHandler(UserController.listMemberships)
);
router.post(
  '/profile',
  ...authWithValidation(UpsertProfileSchema, 'body'),
  asyncHandler(UserController.upsertProfile)
);
router.patch(
  '/me',
  ...authWithValidation(UpdateProfileSchema, 'body'),
  asyncHandler(UserController.updateProfile)
);
router.delete('/me', requireAuth, asyncHandler(UserController.deleteAccount));

export default router;
