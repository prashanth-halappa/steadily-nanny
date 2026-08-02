/**
 * Handoff note controller — HTTP layer ONLY.
 * @module domains/handoff/controllers/handoffController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { handoffCommandService } from '../services/handoffCommandService';
import { handoffQueryService } from '../services/handoffQueryService';
import type { LocalDateQuery } from '../types';

export class HandoffNoteController {
  /** GET /households/:householdId/handoff-notes?local_date= */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const { local_date } = req.validatedQuery as unknown as LocalDateQuery;
      const handoff_notes = await handoffQueryService.listForHousehold(
        getAuthUserId(req),
        householdId,
        local_date
      );
      return sendSuccessResponse(res, 'Handoff notes fetched', {
        handoff_notes,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /households/:householdId/handoff-notes */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const handoff_note = await handoffCommandService.create(
        getAuthUserId(req),
        householdId,
        req.body
      );
      return sendSuccessResponse(
        res,
        'Handoff note created',
        { handoff_note },
        201
      );
    } catch (error) {
      return next(error);
    }
  }

  /** PATCH /handoff-notes/:handoffNoteId */
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const handoffNoteId = req.params.handoffNoteId as string;
      const handoff_note = await handoffCommandService.update(
        getAuthUserId(req),
        handoffNoteId,
        req.body
      );
      return sendSuccessResponse(res, 'Handoff note updated', {
        handoff_note,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** GET /households/:householdId/handoff-notes/recap?local_date= */
  static async recap(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const { local_date } = req.validatedQuery as unknown as LocalDateQuery;
      const recap = await handoffQueryService.getRecap(
        getAuthUserId(req),
        householdId,
        local_date
      );
      return sendSuccessResponse(res, 'Handoff recap fetched', { recap });
    } catch (error) {
      return next(error);
    }
  }
}
