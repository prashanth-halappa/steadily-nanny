/**
 * PTO controller — HTTP layer ONLY. Every authorization decision (parent
 * gate, D12-class time-off assertion, status guard, the read gate) lives in
 * the services; this module unpacks the request and shapes the response,
 * nothing else.
 *
 * @module domains/pay/controllers/ptoController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import type { PtoYearQuery } from '../schemas';
import { ptoCommandService } from '../services/ptoCommandService';
import { ptoQueryService } from '../services/ptoQueryService';

export class PtoController {
  /**
   * GET /households/:householdId/carers/:carerId/pto/balance?year=YYYY.
   * A normal 200 whose `entitlement_minutes` may be `null` — the client
   * renders "not set", never a zero grant (docs/11-MONEY.md §4's
   * no-arrangement-no-zero rule, applied to PTO).
   */
  static async balance(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const carerId = req.params.carerId as string;
      const { year } = req.validatedQuery as unknown as PtoYearQuery;
      const pto_balance = await ptoQueryService.balance(
        getAuthUserId(req),
        householdId,
        carerId,
        year
      );
      return sendSuccessResponse(res, 'PTO balance fetched', { pto_balance });
    } catch (error) {
      return next(error);
    }
  }

  /** GET /households/:householdId/carers/:carerId/pto/ledger?year=YYYY — the year's rows, oldest first. */
  static async ledger(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const carerId = req.params.carerId as string;
      const { year } = req.validatedQuery as unknown as PtoYearQuery;
      const pto_ledger_entries = await ptoQueryService.ledger(
        getAuthUserId(req),
        householdId,
        carerId,
        year
      );
      return sendSuccessResponse(res, 'PTO ledger fetched', {
        pto_ledger_entries,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /households/:householdId/pto/mark-paid — parents only. */
  static async markPaid(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const pto_ledger_entry = await ptoCommandService.markTimeOffPaid(
        getAuthUserId(req),
        householdId,
        req.body
      );
      return sendSuccessResponse(
        res,
        'Time off marked as paid',
        { pto_ledger_entry },
        201
      );
    } catch (error) {
      return next(error);
    }
  }
}
