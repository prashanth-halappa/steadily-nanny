/**
 * Me controller — HTTP layer ONLY for cross-household "me" reads.
 * @module domains/me/controllers/meController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import type { MeShiftRangeQuery } from '../schemas';
import { meQueryService } from '../services/meQueryService';

export class MeController {
  /** GET /me/shifts?from=&to= — the caller's shifts across all households. */
  static async listMyShifts(req: Request, res: Response, next: NextFunction) {
    try {
      const { from, to } = req.validatedQuery as unknown as MeShiftRangeQuery;
      const shifts = await meQueryService.listMyShifts(
        getAuthUserId(req),
        from,
        to
      );
      return sendSuccessResponse(res, 'My shifts fetched', { shifts });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /me/change-requests?from=&to= — pending change requests awaiting the
   * caller's response across all active households (inbox fan-in).
   */
  static async listPendingChangeRequests(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { from, to } = req.validatedQuery as unknown as MeShiftRangeQuery;
      const shift_change_requests =
        await meQueryService.listPendingChangeRequestsAwaitingMe(
          getAuthUserId(req),
          from,
          to
        );
      return sendSuccessResponse(res, 'Pending change requests fetched', {
        shift_change_requests,
      });
    } catch (error) {
      return next(error);
    }
  }
}
