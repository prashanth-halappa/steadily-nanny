/**
 * Child controller — HTTP layer ONLY.
 * @module domains/child/controllers/childController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { childCommandService } from '../services/childCommandService';
import { childQueryService } from '../services/childQueryService';

export class ChildController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const children = await childQueryService.listForHousehold(
        getAuthUserId(req),
        householdId
      );
      return sendSuccessResponse(res, 'Children fetched', { children });
    } catch (error) {
      return next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const childId = req.params.childId as string;
      const child = await childQueryService.getOwned(
        getAuthUserId(req),
        householdId,
        childId
      );
      return sendSuccessResponse(res, 'Child fetched', { child });
    } catch (error) {
      return next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const child = await childCommandService.create(
        getAuthUserId(req),
        householdId,
        req.body
      );
      return sendSuccessResponse(res, 'Child created', { child }, 201);
    } catch (error) {
      return next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const childId = req.params.childId as string;
      const child = await childCommandService.update(
        getAuthUserId(req),
        householdId,
        childId,
        req.body
      );
      return sendSuccessResponse(res, 'Child updated', { child });
    } catch (error) {
      return next(error);
    }
  }

  /** Soft delete — archives, never hard-deletes (see childCommandService.archive). */
  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const childId = req.params.childId as string;
      const child = await childCommandService.archive(
        getAuthUserId(req),
        householdId,
        childId
      );
      return sendSuccessResponse(res, 'Child archived', { child });
    } catch (error) {
      return next(error);
    }
  }
}
