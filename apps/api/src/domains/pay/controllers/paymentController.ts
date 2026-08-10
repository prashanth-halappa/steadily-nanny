/**
 * Payment controller — HTTP layer ONLY. Every authorization decision (the
 * parent gate, the carer read arm, the approved-week and over-payment gates)
 * lives in the services; this module unpacks the request and shapes the
 * response, nothing else.
 *
 * @module domains/pay/controllers/paymentController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { paymentCommandService } from '../services/paymentCommandService';
import { paymentQueryService } from '../services/paymentQueryService';

export class PaymentController {
  /** GET /timesheets/:timesheetId/payments — the week's settlement history, oldest first. */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const timesheetId = req.params.timesheetId as string;
      const payments = await paymentQueryService.listForTimesheet(
        getAuthUserId(req),
        timesheetId
      );
      return sendSuccessResponse(res, 'Payments fetched', { payments });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /households/:householdId/payments — the household's settlement
   * history, newest first. The service decides the SCOPE (every carer's rows
   * for a parent/owner, only her own for a nanny), so there is nothing to
   * choose here.
   */
  static async listForHousehold(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const householdId = req.params.householdId as string;
      const payments = await paymentQueryService.listForHousehold(
        getAuthUserId(req),
        householdId
      );
      return sendSuccessResponse(res, 'Payments fetched', { payments });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /timesheets/:timesheetId/payments — parents only, approved weeks only. */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const timesheetId = req.params.timesheetId as string;
      const payment = await paymentCommandService.create(
        getAuthUserId(req),
        timesheetId,
        req.body
      );
      return sendSuccessResponse(res, 'Payment recorded', { payment }, 201);
    } catch (error) {
      return next(error);
    }
  }
}
