/**
 * Household controller — HTTP layer ONLY.
 * @module domains/household/controllers/householdController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { UnsupportedMemberUpdateError } from '../errors/householdErrors';
import { HOUSEHOLD_MEMBER_STATUSES } from '../schemas';
import { householdCommandService } from '../services/householdCommandService';
import { householdQueryService } from '../services/householdQueryService';
import type { UpdateHouseholdMemberInput } from '../types';

export class HouseholdController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const households = await householdQueryService.listForUser(
        getAuthUserId(req)
      );
      return sendSuccessResponse(res, 'Households fetched', { households });
    } catch (error) {
      return next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const household = await householdCommandService.create(
        getAuthUserId(req),
        req.body
      );
      return sendSuccessResponse(res, 'Household created', { household }, 201);
    } catch (error) {
      return next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const household = await householdQueryService.getOwned(
        getAuthUserId(req),
        householdId
      );
      return sendSuccessResponse(res, 'Household fetched', { household });
    } catch (error) {
      return next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const household = await householdCommandService.update(
        getAuthUserId(req),
        householdId,
        req.body
      );
      return sendSuccessResponse(res, 'Household updated', { household });
    } catch (error) {
      return next(error);
    }
  }

  static async listMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const household_members = await householdQueryService.listMembers(
        getAuthUserId(req),
        householdId
      );
      return sendSuccessResponse(res, 'Household members fetched', {
        household_members,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async createInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const invite = await householdCommandService.createInvite(
        getAuthUserId(req),
        householdId,
        req.body
      );
      return sendSuccessResponse(res, 'Invite created', { invite }, 201);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * The member PATCH accepts exactly one transition: `status: 'removed'`.
   * `UpdateHouseholdMemberSchema` is broader (role, can_edit, colour,
   * display_name_override), and none of those are wired to anything yet — a
   * schema-valid body naming one has to 400 rather than be silently dropped.
   *
   * `status: 'active'` is refused for a stronger reason than "unbuilt":
   * reactivation is redeem-only by design, so household access always costs a
   * single-use invite code rather than a parent flipping a field.
   */
  static async updateMember(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const memberId = req.params.memberId as string;
      const { status } = req.body as UpdateHouseholdMemberInput;
      if (status !== HOUSEHOLD_MEMBER_STATUSES.REMOVED) {
        throw new UnsupportedMemberUpdateError();
      }
      const household_member = await householdCommandService.removeMember(
        getAuthUserId(req),
        householdId,
        memberId
      );
      return sendSuccessResponse(res, 'Household member removed', {
        household_member,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** PATCH an invite. The schema allows only `status: 'revoked'`. */
  static async updateInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const inviteId = req.params.inviteId as string;
      const invite = await householdCommandService.revokeInvite(
        getAuthUserId(req),
        householdId,
        inviteId
      );
      return sendSuccessResponse(res, 'Invite revoked', { invite });
    } catch (error) {
      return next(error);
    }
  }

  static async redeemInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const membership = await householdCommandService.redeemInvite(
        getAuthUserId(req),
        req.body
      );
      return sendSuccessResponse(res, 'Invite redeemed', { membership });
    } catch (error) {
      return next(error);
    }
  }

  static async previewInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const code = req.params.code as string;
      const preview = await householdQueryService.previewInvite(code);
      return sendSuccessResponse(res, 'Invite preview fetched', preview);
    } catch (error) {
      return next(error);
    }
  }
}
