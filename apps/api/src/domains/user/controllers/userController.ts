/**
 * User controller — HTTP layer for the profile endpoints.
 *
 * @module domains/user/controllers/userController
 */
import type { NextFunction, Request, Response } from 'express';
import type {
  UpdateProfileInput,
  UpsertProfileInput,
} from '../../../schemas/user.schema';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { UserService } from '../services/userService';

export const UserController = {
  /** GET /api/v1/users/me */
  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const profile = await UserService.getProfileById(getAuthUserId(req));
      sendSuccessResponse(res, 'User profile', { user: profile });
    } catch (error) {
      next(error);
    }
  },

  /** POST /api/v1/users/profile — create/update the profile (FK parent row). */
  async upsertProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const profile = await UserService.upsertProfile(
        getAuthUserId(req),
        req.body as UpsertProfileInput
      );
      sendSuccessResponse(res, 'Profile saved', { user: profile }, 201);
    } catch (error) {
      next(error);
    }
  },

  /** PATCH /api/v1/users/me */
  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const profile = await UserService.updateProfile(
        getAuthUserId(req),
        req.body as UpdateProfileInput
      );
      sendSuccessResponse(res, 'Profile updated', { user: profile });
    } catch (error) {
      next(error);
    }
  },

  /** DELETE /api/v1/users/me */
  async deleteAccount(req: Request, res: Response, next: NextFunction) {
    try {
      await UserService.deleteUser(getAuthUserId(req));
      sendSuccessResponse(res, 'Account deleted', { success: true });
    } catch (error) {
      next(error);
    }
  },
};
