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
  /**
   * `past_households` is ADDITIVE, never a change to `households`: the
   * active list is byte-for-byte what it always was, and a client parsing
   * the old envelope drops the new key (Zod objects are non-strict). Past
   * households are the ones the caller was removed from — she still reads
   * the hours and pay she accrued there, so the app needs a route to them.
   */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const [households, past_households] = await Promise.all([
        householdQueryService.listForUser(userId),
        householdQueryService.listPastForUser(userId),
      ]);
      return sendSuccessResponse(res, 'Households fetched', {
        households,
        past_households,
      });
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

  /**
   * GET /households/:householdId/members/departed — parent-gated (the role
   * check lives in the query service, which is the only layer that can see
   * the roster). No window on the request: the service owns it deliberately,
   * so there is nothing here to parse and nothing a caller can widen.
   */
  static async listDepartedMembers(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const householdId = req.params.householdId as string;
      const departed_members = await householdQueryService.listDepartedMembers(
        getAuthUserId(req),
        householdId
      );
      return sendSuccessResponse(res, 'Departed members fetched', {
        departed_members,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** GET /households/:householdId/holidays — any active member may read. */
  static async listHolidays(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const household_holidays = await householdQueryService.listHolidays(
        getAuthUserId(req),
        householdId
      );
      return sendSuccessResponse(res, 'Household holidays fetched', {
        household_holidays,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PUT /households/:householdId/holidays — parent-gated (role check in the
   * command service). Answers with the whole calendar, not just what changed.
   */
  static async setHolidays(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const household_holidays = await householdCommandService.setHolidays(
        getAuthUserId(req),
        householdId,
        req.body
      );
      return sendSuccessResponse(res, 'Household holidays updated', {
        household_holidays,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** GET /households/:householdId/custom-holidays — any active member may read. */
  static async listCustomHolidays(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const householdId = req.params.householdId as string;
      const household_custom_holidays =
        await householdQueryService.listCustomHolidays(
          getAuthUserId(req),
          householdId
        );
      return sendSuccessResponse(res, 'Household custom holidays fetched', {
        household_custom_holidays,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PUT /households/:householdId/custom-holidays — parent-gated (role check
   * in the command service). Answers with the whole set, not just what changed.
   */
  static async setCustomHolidays(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const householdId = req.params.householdId as string;
      const household_custom_holidays =
        await householdCommandService.setCustomHolidays(
          getAuthUserId(req),
          householdId,
          req.body
        );
      return sendSuccessResponse(res, 'Household custom holidays updated', {
        household_custom_holidays,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * The parent's own record of every code she has minted. Parents only — the
   * role check lives in the query service, because only it can see the roster.
   */
  static async listInvites(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const household_invites = await householdQueryService.listInvites(
        getAuthUserId(req),
        householdId
      );
      return sendSuccessResponse(res, 'Invites retrieved', {
        household_invites,
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

  /**
   * Leave the household yourself. A POST with no body and no member id: the
   * caller IS the subject, which is exactly why it is not the member PATCH
   * (that one refuses a self-directed removal on purpose — see
   * `CannotRemoveSelfError`). Every refusal lives in the command service.
   */
  static async leave(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const household_member = await householdCommandService.leave(
        getAuthUserId(req),
        householdId
      );
      return sendSuccessResponse(res, 'Left household', { household_member });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Close a household without deleting anything (A4/A10). The same HTTP shape
   * as `leave` — a POST with no body and no member id, because the caller IS
   * the subject — and the same division of labour: every refusal (not a
   * member, a carer still attached, a nanny who should be leaving instead)
   * lives in the command service, and the response is the caller's own,
   * now-`removed` membership row.
   */
  static async archive(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const household_member = await householdCommandService.archive(
        getAuthUserId(req),
        householdId
      );
      return sendSuccessResponse(res, 'Household archived', {
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
