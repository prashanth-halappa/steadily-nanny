/**
 * Co-parent approval controller — HTTP layer ONLY.
 * @module domains/household/controllers/approvalController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { coParentApprovalCommandService } from '../services/coParentApprovalCommandService';
import { coParentApprovalQueryService } from '../services/coParentApprovalQueryService';

export class ApprovalController {
  static async listPending(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const co_parent_approvals =
        await coParentApprovalQueryService.listPending(
          getAuthUserId(req),
          householdId
        );
      return sendSuccessResponse(res, 'Approvals fetched', {
        co_parent_approvals,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async respond(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const approvalId = req.params.approvalId as string;
      const approval = await coParentApprovalCommandService.respond(
        getAuthUserId(req),
        householdId,
        approvalId,
        req.body
      );
      return sendSuccessResponse(res, 'Approval updated', { approval });
    } catch (error) {
      return next(error);
    }
  }
}
