/**
 * Shift-change-request controller — HTTP layer ONLY.
 * @module domains/shift/controllers/shiftChangeRequestController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { shiftChangeRequestCommandService } from '../services/shiftChangeRequestCommandService';
import { shiftChangeRequestQueryService } from '../services/shiftChangeRequestQueryService';

export class ShiftChangeRequestController {
  /** POST /shifts/:shiftId/change-requests */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = req.params.shiftId as string;
      const result = await shiftChangeRequestCommandService.create(
        getAuthUserId(req),
        shiftId,
        req.body
      );
      if (result.status === 'pending_approval') {
        return sendSuccessResponse(res, 'Co-parent approval required', {
          status: result.status,
          approval: result.approval,
        });
      }
      return sendSuccessResponse(res, 'Change request created', {
        status: result.status,
        shift_change_request: result.shift_change_request,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** GET /shifts/:shiftId/change-requests */
  static async listForShift(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = req.params.shiftId as string;
      const shift_change_requests =
        await shiftChangeRequestQueryService.listForShift(
          getAuthUserId(req),
          shiftId
        );
      return sendSuccessResponse(res, 'Change requests fetched', {
        shift_change_requests,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /change-requests/:changeRequestId/respond */
  static async respond(req: Request, res: Response, next: NextFunction) {
    try {
      const changeRequestId = req.params.changeRequestId as string;
      const result = await shiftChangeRequestCommandService.respond(
        getAuthUserId(req),
        changeRequestId,
        req.body
      );
      return sendSuccessResponse(res, 'Change request responded', result);
    } catch (error) {
      return next(error);
    }
  }

  /** POST /change-requests/:changeRequestId/withdraw */
  static async withdraw(req: Request, res: Response, next: NextFunction) {
    try {
      const changeRequestId = req.params.changeRequestId as string;
      const shift_change_request =
        await shiftChangeRequestCommandService.withdraw(
          getAuthUserId(req),
          changeRequestId
        );
      return sendSuccessResponse(res, 'Change request withdrawn', {
        shift_change_request,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /households/:householdId/shifts/extra */
  static async createExtraShift(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const householdId = req.params.householdId as string;
      const result = await shiftChangeRequestCommandService.createExtraShift(
        getAuthUserId(req),
        householdId,
        req.body
      );
      if (result.status === 'pending_approval') {
        return sendSuccessResponse(res, 'Co-parent approval required', {
          status: result.status,
          approval: result.approval,
        });
      }
      return sendSuccessResponse(res, 'Extra shift proposed', {
        status: result.status,
        shift: result.shift,
      });
    } catch (error) {
      return next(error);
    }
  }
}
