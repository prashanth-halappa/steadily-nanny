/**
 * Household-closure controller — HTTP layer ONLY.
 * @module domains/availability/controllers/householdClosureController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { householdClosureCommandService } from '../services/householdClosureCommandService';
import { householdClosureQueryService } from '../services/householdClosureQueryService';

export class HouseholdClosureController {
  /** GET /households/:householdId/closures — member-visible. */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const household_closures =
        await householdClosureQueryService.listForHousehold(
          getAuthUserId(req),
          householdId
        );
      return sendSuccessResponse(res, 'Household closures fetched', {
        household_closures,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /households/:householdId/closures — parent-gated. */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const household_closure = await householdClosureCommandService.create(
        getAuthUserId(req),
        householdId,
        req.body
      );
      return sendSuccessResponse(
        res,
        'Household closure created',
        { household_closure },
        201
      );
    } catch (error) {
      return next(error);
    }
  }

  /** PATCH /households/:householdId/closures/:closureId — parent-gated. */
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const closureId = req.params.closureId as string;
      const household_closure = await householdClosureCommandService.update(
        getAuthUserId(req),
        householdId,
        closureId,
        req.body
      );
      return sendSuccessResponse(res, 'Household closure updated', {
        household_closure,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** DELETE /households/:householdId/closures/:closureId — parent-gated. */
  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const closureId = req.params.closureId as string;
      await householdClosureCommandService.remove(
        getAuthUserId(req),
        householdId,
        closureId
      );
      return sendSuccessResponse(res, 'Household closure deleted', {});
    } catch (error) {
      return next(error);
    }
  }
}
