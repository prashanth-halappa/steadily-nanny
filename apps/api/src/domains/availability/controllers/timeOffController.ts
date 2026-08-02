/**
 * Time-off controller — HTTP layer ONLY.
 * @module domains/availability/controllers/timeOffController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { timeOffCommandService } from '../services/timeOffCommandService';
import { timeOffQueryService } from '../services/timeOffQueryService';

export class TimeOffController {
  /** GET /time-off — the caller's own rows (including cancelled). */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const carer_time_off = await timeOffQueryService.listOwn(
        getAuthUserId(req)
      );
      return sendSuccessResponse(res, 'Time off fetched', { carer_time_off });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /time-off — create for the caller. */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const carer_time_off = await timeOffCommandService.create(
        getAuthUserId(req),
        req.body
      );
      return sendSuccessResponse(
        res,
        'Time off created',
        { carer_time_off },
        201
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * DELETE /time-off/:id — soft-cancel (status -> 'cancelled'), never a hard
   * delete. Responds 200 with the cancelled row, consistent with how the
   * household domain shapes soft-state mutations.
   */
  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const carer_time_off = await timeOffCommandService.cancel(
        getAuthUserId(req),
        id
      );
      return sendSuccessResponse(res, 'Time off cancelled', {
        carer_time_off,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** PATCH /time-off/:id — edit dates/message on an active row. */
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const carer_time_off = await timeOffCommandService.update(
        getAuthUserId(req),
        id,
        req.body
      );
      return sendSuccessResponse(res, 'Time off updated', { carer_time_off });
    } catch (error) {
      return next(error);
    }
  }
}
