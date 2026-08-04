/**
 * Pay arrangement controller — HTTP layer ONLY. Every authorization decision
 * (parent gate, carer assertion, helper denial) lives in the services; this
 * module unpacks the request and shapes the response, nothing else.
 *
 * @module domains/pay/controllers/payArrangementController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { payArrangementCommandService } from '../services/payArrangementCommandService';
import { payArrangementQueryService } from '../services/payArrangementQueryService';

export class PayArrangementController {
  /**
   * GET /households/:householdId/carers/:carerId/pay-arrangements/current.
   * `pay_arrangement: null` is a normal 200 — the client renders "no rate
   * set", never £0.00 (docs/11-MONEY.md §4).
   */
  static async getCurrent(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const carerId = req.params.carerId as string;
      const pay_arrangement = await payArrangementQueryService.getCurrent(
        getAuthUserId(req),
        householdId,
        carerId
      );
      return sendSuccessResponse(res, 'Current pay arrangement fetched', {
        pay_arrangement,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** GET /households/:householdId/carers/:carerId/pay-arrangements — history, newest first. */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const carerId = req.params.carerId as string;
      const pay_arrangements = await payArrangementQueryService.getHistory(
        getAuthUserId(req),
        householdId,
        carerId
      );
      return sendSuccessResponse(res, 'Pay arrangements fetched', {
        pay_arrangements,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /households/:householdId/carers/:carerId/pay-arrangements — parents only. */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const carerId = req.params.carerId as string;
      const pay_arrangement = await payArrangementCommandService.create(
        getAuthUserId(req),
        householdId,
        carerId,
        req.body
      );
      return sendSuccessResponse(
        res,
        'Pay arrangement created',
        { pay_arrangement },
        201
      );
    } catch (error) {
      return next(error);
    }
  }
}
