/**
 * Household routes — routing + middleware wiring only. Mounted at
 * `/api/v1/households` (behind the global Supabase auth). Each route reads as
 * one declarative chain: auth (+ownership) -> validate(input) ->
 * asyncHandler(controller).
 *
 * @module domains/household/routes/householdRoutes
 */
import { Router } from 'express';
import { requireAuth } from '../../../middlewares/auth';
import {
  authWithOwnership,
  authWithValidation,
} from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { HouseholdController } from '../controllers/householdController';
import {
  CreateHouseholdInviteSchema,
  CreateHouseholdSchema,
  HouseholdIdParamSchema,
  HouseholdInviteParamSchema,
  HouseholdMemberParamSchema,
  InviteCodeParamSchema,
  RedeemHouseholdInviteSchema,
  UpdateHouseholdInviteSchema,
  UpdateHouseholdMemberSchema,
  UpdateHouseholdSchema,
} from '../schemas';
import { householdQueryService } from '../services/householdQueryService';
import type { Household } from '../types';

const router = Router();

// Shared ownership guard for /:householdId routes. The lookup throws
// HouseholdNotFoundError (-> 404) for both "missing" and "not a member" — see
// householdQueryService.getOwned.
const householdOwnership = {
  param: 'householdId',
  lookup: (userId: string, householdId: string): Promise<Household> =>
    householdQueryService.getOwned(userId, householdId),
};

// --- Invite routes registered before the generic /:householdId routes below
// so 'invites' is matched as a literal segment, not swallowed by :householdId. ---

// Redeem — no ownership concept yet (the caller isn't a member until this runs).
router.post(
  '/invites/redeem',
  ...authWithValidation(RedeemHouseholdInviteSchema, 'body'),
  asyncHandler(HouseholdController.redeemInvite)
);

// Preview — deliberately NOT ownership-gated; the nanny isn't a member yet.
router.get(
  '/invites/:code/preview',
  ...authWithValidation(InviteCodeParamSchema, 'params'),
  asyncHandler(HouseholdController.previewInvite)
);

// List the caller's own households.
router.get('/', requireAuth, asyncHandler(HouseholdController.list));

// Create — also creates the owner's membership row (see command service).
router.post(
  '/',
  ...authWithValidation(CreateHouseholdSchema, 'body'),
  asyncHandler(HouseholdController.create)
);

// Read one (membership-checked).
router.get(
  '/:householdId',
  ...authWithOwnership(HouseholdIdParamSchema, householdOwnership),
  asyncHandler(HouseholdController.getById)
);

// Update — parents only (role check in the command service).
router.patch(
  '/:householdId',
  ...authWithOwnership(HouseholdIdParamSchema, householdOwnership),
  validate(UpdateHouseholdSchema, 'body'),
  asyncHandler(HouseholdController.update)
);

// List members — any active member may read.
router.get(
  '/:householdId/members',
  ...authWithOwnership(HouseholdIdParamSchema, householdOwnership),
  asyncHandler(HouseholdController.listMembers)
);

// Generate an invite code — parents only (role check in the command service).
router.post(
  '/:householdId/invites',
  ...authWithOwnership(HouseholdIdParamSchema, householdOwnership),
  validate(CreateHouseholdInviteSchema, 'body'),
  asyncHandler(HouseholdController.createInvite)
);

// Remove a member — parents only (role check in the command service). The
// controller accepts only `status: 'removed'`; see its doc comment.
router.patch(
  '/:householdId/members/:memberId',
  ...authWithOwnership(HouseholdMemberParamSchema, householdOwnership),
  validate(UpdateHouseholdMemberSchema, 'body'),
  asyncHandler(HouseholdController.updateMember)
);

// Revoke a pending invite — parents only (role check in the command service).
router.patch(
  '/:householdId/invites/:inviteId',
  ...authWithOwnership(HouseholdInviteParamSchema, householdOwnership),
  validate(UpdateHouseholdInviteSchema, 'body'),
  asyncHandler(HouseholdController.updateInvite)
);

export default router;
