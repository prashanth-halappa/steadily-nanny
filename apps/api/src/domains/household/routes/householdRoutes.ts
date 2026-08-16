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
  RedeemHouseholdInviteBodySchema,
  SetHouseholdHolidaysRequestSchema,
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
// The SERVER-side body schema: the shared one plus §8.2's optional
// `target_household_id`, the household a parent explicitly picked to absorb her
// into. `validate()` writes the parsed object back over `req.body` and Zod
// strips unknown keys, so validating with the shared schema here would silently
// drop the target and every absorption would instantiate a second household —
// the exact duplicate-family mess D-34 exists to prevent.
router.post(
  '/invites/redeem',
  ...authWithValidation(RedeemHouseholdInviteBodySchema, 'body'),
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

// The household's holiday calendar (080). Read: any active member — what the
// family observes is a term of the nanny's employment. Write: parents only
// (role check in the command service). A PUT, not a PATCH, because the body is
// a SET of toggles; keys it does not name are left alone all the same.
router.get(
  '/:householdId/holidays',
  ...authWithOwnership(HouseholdIdParamSchema, householdOwnership),
  asyncHandler(HouseholdController.listHolidays)
);

router.put(
  '/:householdId/holidays',
  ...authWithOwnership(HouseholdIdParamSchema, householdOwnership),
  validate(SetHouseholdHolidaysRequestSchema, 'body'),
  asyncHandler(HouseholdController.setHolidays)
);

// Generate an invite code — parents only (role check in the command service).
router.post(
  '/:householdId/invites',
  ...authWithOwnership(HouseholdIdParamSchema, householdOwnership),
  validate(CreateHouseholdInviteSchema, 'body'),
  asyncHandler(HouseholdController.createInvite)
);

// Leave the household yourself. Registered BEFORE the `/members/:memberId`
// route below on the same literal-before-param principle the invite routes at
// the top of this file follow: 'leave' must never be read as a member id. It
// happens to be safe today only because that route is a PATCH and this is a
// POST — that is a coincidence of verbs, not a guarantee, and the ordering is
// what actually holds if either verb ever changes.
//
// No ROLE gate: any active member may leave, so the ownership preset (active
// membership, 404 otherwise) is the whole authorization. No body to validate —
// the caller is the subject.
router.post(
  '/:householdId/members/leave',
  ...authWithOwnership(HouseholdIdParamSchema, householdOwnership),
  asyncHandler(HouseholdController.leave)
);

// Archive the household — close it, never delete it (A4/A10). Wired exactly
// like `/members/leave` above and for the same reasons: the ownership preset
// (active membership, 404 otherwise) is the whole authorization the ROUTE
// owes, and there is no body to validate because the caller is the subject.
// The role rules — parent or draft author only, and never while a carer is
// still attached — belong to the command service, which is the only place that
// can see the household's state and its roster.
router.post(
  '/:householdId/archive',
  ...authWithOwnership(HouseholdIdParamSchema, householdOwnership),
  asyncHandler(HouseholdController.archive)
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
