/**
 * Household controller — HTTP layer ONLY.
 * @module domains/household/controllers/householdController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { householdCommandService } from '../services/householdCommandService';
import { householdQueryService } from '../services/householdQueryService';

export class HouseholdController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const households = await householdQueryService.listForUser(
        getAuthUserId(req)
      );
      return sendSuccessResponse(res, 'Households fetched', { households });
    } catch (error) {
      return next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const household = await householdCommandService.create(
        getAuthUserId(req),
        req.body
      );
      return sendSuccessResponse(res, 'Household created', { household }, 201);
    } catch (error) {
      return next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const household = await householdQueryService.getOwned(
        getAuthUserId(req),
        householdId
      );
      return sendSuccessResponse(res, 'Household fetched', { household });
    } catch (error) {
      return next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const household = await householdCommandService.update(
        getAuthUserId(req),
        householdId,
        req.body
      );
      return sendSuccessResponse(res, 'Household updated', { household });
    } catch (error) {
      return next(error);
    }
  }

  static async listMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const household_members = await householdQueryService.listMembers(
        getAuthUserId(req),
        householdId
      );
      return sendSuccessResponse(res, 'Household members fetched', {
        household_members,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async createInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const invite = await householdCommandService.createInvite(
        getAuthUserId(req),
        householdId,
        req.body
      );
      return sendSuccessResponse(res, 'Invite created', { invite }, 201);
    } catch (error) {
      return next(error);
    }
  }

  static async redeemInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const membership = await householdCommandService.redeemInvite(
        getAuthUserId(req),
        req.body
      );
      return sendSuccessResponse(res, 'Invite redeemed', { membership });
    } catch (error) {
      return next(error);
    }
  }

  static async previewInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const code = req.params.code as string;
      const preview = await householdQueryService.previewInvite(code);
      return sendSuccessResponse(res, 'Invite preview fetched', preview);
    } catch (error) {
      return next(error);
    }
  }
}
