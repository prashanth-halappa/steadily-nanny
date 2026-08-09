/**
 * Child-commitment controller — HTTP layer ONLY.
 * @module domains/child/controllers/childCommitmentController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { childCommitmentCommandService } from '../services/childCommitmentCommandService';
import { childCommitmentQueryService } from '../services/childCommitmentQueryService';

export class ChildCommitmentController {
  static async listForHousehold(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const householdId = req.params.householdId as string;
      const child_commitments =
        await childCommitmentQueryService.listForHousehold(
          getAuthUserId(req),
          householdId
        );
      return sendSuccessResponse(res, 'Child commitments fetched', {
        child_commitments,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const childId = req.params.childId as string;
      const child_commitments = await childCommitmentQueryService.listForChild(
        getAuthUserId(req),
        householdId,
        childId
      );
      return sendSuccessResponse(res, 'Child commitments fetched', {
        child_commitments,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const childId = req.params.childId as string;
      const child_commitment = await childCommitmentCommandService.create(
        getAuthUserId(req),
        householdId,
        childId,
        req.body
      );
      return sendSuccessResponse(
        res,
        'Child commitment created',
        { child_commitment },
        201
      );
    } catch (error) {
      return next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const commitmentId = req.params.commitmentId as string;
      const child_commitment = await childCommitmentCommandService.update(
        getAuthUserId(req),
        commitmentId,
        req.body
      );
      return sendSuccessResponse(res, 'Child commitment updated', {
        child_commitment,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** Hard delete — see childCommitmentCommandService.remove for why. */
  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const commitmentId = req.params.commitmentId as string;
      await childCommitmentCommandService.remove(
        getAuthUserId(req),
        commitmentId
      );
      return sendSuccessResponse(res, 'Child commitment deleted', {
        success: true,
      });
    } catch (error) {
      return next(error);
    }
  }
}
