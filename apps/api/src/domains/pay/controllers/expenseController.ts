/**
 * Expense controller — HTTP layer ONLY. Every authorization decision (carer
 * gate, D12-class membership assertion, parent-review gate, currency check,
 * pending-status guard) lives in the query/command services; this module
 * unpacks the request and shapes the response, nothing else.
 *
 * @module domains/pay/controllers/expenseController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { expenseCommandService } from '../services/expenseCommandService';
import { expenseQueryService } from '../services/expenseQueryService';

/** Query params for GET /households/:householdId/expenses. */
interface ExpenseListQuery {
  week_start?: string;
  status?: string;
}

export class ExpenseController {
  /**
   * GET /households/:householdId/expenses?week_start=&status=.
   *
   * `status=pending` routes to the parent's review queue /
   * "my pending claims" view (`listPending`); otherwise this is the
   * household-local WEEK read (`listForWeek`), `week_start` optional
   * (defaults to the current household-local week).
   */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const query = (req.validatedQuery ?? {}) as ExpenseListQuery;
      const expenses =
        query.status === 'pending'
          ? await expenseQueryService.listPending(
              getAuthUserId(req),
              householdId
            )
          : await expenseQueryService.listForWeek(
              getAuthUserId(req),
              householdId,
              query.week_start
            );
      return sendSuccessResponse(res, 'Expenses fetched', { expenses });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /households/:householdId/expenses — the carer submits her own claim. */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const expense = await expenseCommandService.create(
        getAuthUserId(req),
        householdId,
        req.body
      );
      return sendSuccessResponse(res, 'Expense submitted', { expense }, 201);
    } catch (error) {
      return next(error);
    }
  }

  /** PATCH /expenses/:expenseId — the owning carer edits her own pending claim. */
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const expenseId = req.params.expenseId as string;
      const expense = await expenseCommandService.update(
        getAuthUserId(req),
        expenseId,
        req.body
      );
      return sendSuccessResponse(res, 'Expense updated', { expense });
    } catch (error) {
      return next(error);
    }
  }

  /** DELETE /expenses/:expenseId — the owning carer withdraws her own pending claim. */
  static async withdraw(req: Request, res: Response, next: NextFunction) {
    try {
      const expenseId = req.params.expenseId as string;
      await expenseCommandService.withdraw(getAuthUserId(req), expenseId);
      return sendSuccessResponse(res, 'Expense withdrawn', {});
    } catch (error) {
      return next(error);
    }
  }

  /** POST /expenses/:expenseId/review — parent-only approve/reject. */
  static async review(req: Request, res: Response, next: NextFunction) {
    try {
      const expenseId = req.params.expenseId as string;
      const expense = await expenseCommandService.review(
        getAuthUserId(req),
        expenseId,
        req.body
      );
      return sendSuccessResponse(res, 'Expense reviewed', { expense });
    } catch (error) {
      return next(error);
    }
  }
}
