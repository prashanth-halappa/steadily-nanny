/**
 * Reimbursement settlement controller — HTTP layer ONLY. Every authorization
 * decision (the read scope, the parent gate) and every money decision (the
 * server-computed amount, the stamped currency, the zero-sum refusal) lives in
 * `reimbursementSettlementService`; this module unpacks the request and shapes
 * the response, nothing else.
 *
 * @module domains/pay/controllers/reimbursementSettlementController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { reimbursementSettlementService } from '../services/reimbursementSettlementService';

/** Query params for GET /households/:householdId/reimbursement-settlements. */
interface SettlementListQuery {
  weekStart?: string;
}

export class ReimbursementSettlementController {
  /**
   * GET /households/:householdId/reimbursement-settlements?weekStart=.
   * `weekStart` optional — omitted means the current household-local week,
   * resolved server-side from the household's timezone AND `week_starts_on`.
   */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const query = (req.validatedQuery ?? {}) as SettlementListQuery;
      const settlements = await reimbursementSettlementService.listForWeek(
        getAuthUserId(req),
        householdId,
        query.weekStart
      );
      return sendSuccessResponse(res, 'Reimbursement settlements fetched', {
        settlements,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async listUnsettled(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const weeks = await reimbursementSettlementService.listUnsettled(
        getAuthUserId(req),
        householdId
      );
      return sendSuccessResponse(res, 'Unsettled reimbursements fetched', {
        weeks,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /households/:householdId/reimbursement-settlements — parents only.
   * The body names WHICH carer-week is being settled and nothing about the
   * money; the amount and currency are computed and stamped in the service.
   */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const settlement = await reimbursementSettlementService.create(
        getAuthUserId(req),
        householdId,
        req.body
      );
      return sendSuccessResponse(
        res,
        'Reimbursement settled',
        { settlement },
        201
      );
    } catch (error) {
      return next(error);
    }
  }
}
